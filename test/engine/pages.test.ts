import { expect, test } from "vitest"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import type { Circuit } from "../../src/engine/model.js"

const MAIN = "main.circuit.tsx"
const noPads = { padCount: () => undefined }

function build(body: string): Circuit {
  const source = `export default () => (\n  <board width="10mm" height="10mm">\n${body}\n  </board>\n)\n`
  return elaborate(evaluateCircuit({ [MAIN]: source }, MAIN), MAIN, noPads)
}

const pageOf = (circuit: Circuit, id: string) => circuit.components.find((c) => c.id === id)?.page

test("a circuit without pages has one page, Main", () => {
  const circuit = build(`<resistor name="R1" />`)
  expect(circuit.pages).toEqual(["Main"])
  expect(pageOf(circuit, "R1")).toBeUndefined()
  expect(circuit.diagnostics).toEqual([])
})

test("parts, traces and drawings know their page; parts outside any page are on Main", () => {
  const circuit = build(
    [
      `<resistor name="R1" />`,
      `<page name="Power">`,
      `  <capacitor name="C1" />`,
      `  <trace from="C1.pin1" to="net.VBUS" />`,
      `  <schematictext x={0} y={0} text="Power" />`,
      `</page>`,
      `<page name="IO">`,
      `  <group schX={2}><led name="D1" /></group>`,
      `</page>`,
      `<trace from="R1.pin1" to="net.VBUS" />`,
    ].join("\n"),
  )
  expect(circuit.pages).toEqual(["Main", "Power", "IO"])
  expect(pageOf(circuit, "R1")).toBeUndefined()
  expect(pageOf(circuit, "C1")).toBe("Power")
  expect(pageOf(circuit, "D1")).toBe("IO")
  expect(circuit.connections.map((c) => [c.id, c.page])).toEqual([
    ["C1.pin1|net.VBUS", "Power"],
    ["R1.pin1|net.VBUS", undefined],
  ])
  expect(circuit.drawings.map((d) => d.page)).toEqual(["Power"])
  expect(circuit.diagnostics).toEqual([])
})

test("a net label with the same name on two pages is one net", () => {
  const circuit = build(
    [`<resistor name="R1" />`, `<trace from="R1.pin1" to="net.SDA" />`, `<page name="IO">`, `  <resistor name="R2" />`, `  <trace from="R2.pin1" to="net.SDA" />`, `</page>`].join("\n"),
  )
  expect(circuit.nets.find((n) => n.id === "net.SDA")?.pins).toEqual(["R1.pin1", "R2.pin1"])
})

test("a page written twice is one page; a page named Main is the first page", () => {
  const circuit = build(
    [`<page name="IO"><resistor name="R1" /></page>`, `<page name="Main"><resistor name="R2" /></page>`, `<page name="IO"><resistor name="R3" /></page>`].join("\n"),
  )
  expect(circuit.pages).toEqual(["Main", "IO"])
  expect([pageOf(circuit, "R1"), pageOf(circuit, "R2"), pageOf(circuit, "R3")]).toEqual(["IO", undefined, "IO"])
})

test("a page needs a name and does not nest", () => {
  const circuit = build([`<page><resistor name="R1" /></page>`, `<page name="A">`, `  <page name="B"><resistor name="R2" /></page>`, `</page>`].join("\n"))
  expect(circuit.pages).toEqual(["Main", "A"])
  expect(pageOf(circuit, "R1")).toBeUndefined()
  expect(pageOf(circuit, "R2")).toBe("A")
  expect(circuit.diagnostics.map((d) => [d.code, d.severity])).toEqual([
    ["missing-name", "error"],
    ["nested-page", "error"],
  ])
})
