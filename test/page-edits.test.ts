import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits, EditError } from "../src/core/edit.js"
import { elaborate } from "../src/engine/elaborate.js"
import { evaluateCircuit } from "../src/engine/evaluate.js"

const MAIN = "main.circuit.tsx"
const file = (body: string[]) => `export default () => (\n  <board width="10mm" height="10mm">\n${body.map((line) => `    ${line}`).join("\n")}\n  </board>\n)\n`
const none = new Set<string>()
const pagesOf = (source: string) => {
  const circuit = elaborate(evaluateCircuit({ [MAIN]: source }, MAIN), MAIN, { padCount: () => undefined })
  return Object.fromEntries(circuit.components.map((c) => [c.id, c.page ?? "Main"]))
}

const twoPages = file([
  `<resistor name="R1" schX={2} schY={1} />`,
  `<page name="Power">`,
  `  <capacitor name="C1" schX={4} schY={0} />`,
  `  <trace from="C1.pin1" to="net.VBUS" />`,
  `</page>`,
  `<trace from="R1.pin1" to="net.VBUS" schematicRouteHints={[{ x: 3, y: 1 }]} />`,
  `<trace from="R1.pin2" to="net.GND" />`,
])

describe("the scan", () => {
  test("a page is not a part, and parts, traces and drawings know their page", () => {
    const model = analyzeCircuit(twoPages)
    expect(model.parts.map((p) => [p.name, p.page])).toEqual([
      ["R1", undefined],
      ["C1", "Power"],
    ])
    expect(model.traces.map((t) => t.page)).toEqual(["Power", undefined, undefined])
    expect(model.pages?.map((p) => p.name)).toEqual(["Power"])
  })
})

describe("adding a part on a page", () => {
  test("goes before the page's first trace", () => {
    const next = applyEdits(twoPages, [{ kind: "addPart", tag: "resistor", name: "R2", page: "Power" }], none)
    expect(next).toContain(`      <capacitor name="C1" schX={4} schY={0} />\n      <resistor name="R2" />\n      <trace from="C1.pin1"`)
    expect(pagesOf(next)["R2"]).toBe("Power")
  })

  test("makes the page at the end of the board when it is not written yet", () => {
    const next = applyEdits(twoPages, [{ kind: "addPart", tag: "led", name: "D1", page: "IO" }], none)
    expect(next).toContain(`    <page name="IO">\n      <led name="D1" />\n    </page>\n  </board>`)
    expect(pagesOf(next)["D1"]).toBe("IO")
  })

  test("on Main, or without a page, goes on the board as before", () => {
    const main = applyEdits(twoPages, [{ kind: "addPart", tag: "led", name: "D1", page: "Main" }], none)
    expect(main).toBe(applyEdits(twoPages, [{ kind: "addPart", tag: "led", name: "D1" }], none))
    expect(pagesOf(main)["D1"]).toBe("Main")
  })

  test("a self-closing page is opened to take it", () => {
    const empty = file([`<resistor name="R1" />`, `<page name="IO" />`])
    const next = applyEdits(empty, [{ kind: "addPart", tag: "led", name: "D1", page: "IO" }], none)
    expect(next).toContain(`    <page name="IO">\n      <led name="D1" />\n    </page>\n  </board>`)
  })

  test("a trace may go on a page too", () => {
    const next = applyEdits(twoPages, [{ kind: "addTrace", from: "C1.pin2", to: "net.GND", page: "Power" }], none)
    expect(next).toContain(`<trace from="C1.pin1" to="net.VBUS" />\n      <trace from="C1.pin2" to="net.GND" />\n    </page>`)
  })

  test("a bad page name is refused", () => {
    expect(() => applyEdits(twoPages, [{ kind: "addPart", tag: "led", name: "D1", page: "<x>" }], none)).toThrow(EditError)
  })
})

describe("moving a part to another page", () => {
  test("moves the part and its hand-drawn wires, and keeps their positions; plain traces stay", () => {
    const next = applyEdits(twoPages, [{ kind: "movePartToPage", part: "R1", page: "Power" }], none)
    expect(pagesOf(next)).toEqual({ C1: "Power", R1: "Power" })
    expect(next).toContain(`<resistor name="R1" schX={2} schY={1} />`)
    const model = analyzeCircuit(next)
    expect(model.traces.map((t) => [t.from, t.page])).toEqual([
      ["C1.pin1", "Power"],
      ["R1.pin1", "Power"],
      ["R1.pin2", undefined],
    ])
  })

  test("back to Main puts it on the board", () => {
    const next = applyEdits(twoPages, [{ kind: "movePartToPage", part: "C1", page: "Main" }], none)
    expect(pagesOf(next)).toEqual({ R1: "Main", C1: "Main" })
  })

  test("to a page not written yet makes it", () => {
    const next = applyEdits(twoPages, [{ kind: "movePartToPage", part: "R1", page: "IO" }], none)
    expect(pagesOf(next)).toEqual({ C1: "Power", R1: "IO" })
  })

  test("refuses a locked part, a part already there, and a part inside a group", () => {
    expect(() => applyEdits(twoPages, [{ kind: "movePartToPage", part: "R1", page: "Power" }], new Set(["R1"]))).toThrow(/locked/)
    expect(() => applyEdits(twoPages, [{ kind: "movePartToPage", part: "C1", page: "Power" }], none)).toThrow(/already on page Power/)
    const grouped = file([`<group schX={1}><resistor name="R1" /></group>`])
    expect(() => applyEdits(grouped, [{ kind: "movePartToPage", part: "R1", page: "IO" }], none)).toThrow(/inside a <group>/)
  })
})

describe("adding, renaming and removing pages", () => {
  test("adds an empty page at the end of the board", () => {
    const next = applyEdits(twoPages, [{ kind: "addPage", name: "Sensors" }], none)
    expect(next).toContain(`    <page name="Sensors">\n    </page>\n  </board>`)
    expect(analyzeCircuit(next).pages?.map((p) => p.name)).toEqual(["Power", "Sensors"])
    expect(() => applyEdits(twoPages, [{ kind: "addPage", name: "Power" }], none)).toThrow(/already a page/)
    expect(() => applyEdits(twoPages, [{ kind: "addPage", name: "Main" }], none)).toThrow(/already a page/)
  })

  test("renames every element of the page", () => {
    const split = file([`<page name="IO"><resistor name="R1" /></page>`, `<page name="IO"><resistor name="R2" /></page>`])
    const next = applyEdits(split, [{ kind: "renamePage", from: "IO", to: "Connectors" }], none)
    expect(pagesOf(next)).toEqual({ R1: "Connectors", R2: "Connectors" })
    expect(() => applyEdits(split, [{ kind: "renamePage", from: "Main", to: "X" }], none)).toThrow(/cannot be renamed/)
    expect(() => applyEdits(split, [{ kind: "renamePage", from: "Nope", to: "X" }], none)).toThrow(/No page named Nope/)
  })

  test("removes a page without parts, and refuses one with parts", () => {
    const withEmpty = applyEdits(twoPages, [{ kind: "addPage", name: "Spare" }], none)
    expect(applyEdits(withEmpty, [{ kind: "removePage", name: "Spare" }], none)).toBe(twoPages)
    expect(() => applyEdits(twoPages, [{ kind: "removePage", name: "Power" }], none)).toThrow(/still has parts \(C1\)/)
    expect(() => applyEdits(twoPages, [{ kind: "removePage", name: "Main" }], none)).toThrow(/cannot be removed/)
  })
})
