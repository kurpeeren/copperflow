import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import { cutRefusal, localDesignators, planCut } from "../src/core/sheet-cut.js"
import { cutOrigin, defaultInstanceName, parentEdits, sheetSource } from "../src/core/sheet-cut-text.js"
import { CUT_MAIN } from "./helpers/cut-fixture.js"

const SELECTED = ["R5", "C3", "R6"]

describe("the boundary of a selection", () => {
  const model = analyzeCircuit(CUT_MAIN)
  const plan = planCut(model, SELECTED, false)

  test("every net crossing it is a port named after the net, a crossing bus member a bus port, an unnamed net after its first pin", () => {
    expect(plan.ports).toEqual([{ name: "C3_pin2" }, { name: "D[0:3]", bus: true }, { name: "VIN" }])
    expect(plan.connections).toEqual({ C3_pin2: "C3_pin2", "D[0:3]": "D[0:3]", VIN: "VIN" })
  })

  test("the wires among the parts move, the wires across the boundary are replaced by traces to the port's net on both sides", () => {
    expect(plan.moved.map((t) => `${t.from} ${t.to}`)).toEqual(["R5.pin2 C3.pin1", "R5.pin1 net.VIN", "R6.pin1 net.D1", "R6.pin2 net.GND"])
    expect(plan.parentTraces).toEqual([{ pin: "R7.pin2", net: "C3_pin2" }])
    expect(plan.sheetTraces).toEqual([{ pin: "C3.pin2", net: "C3_pin2" }])
  })

  test("a net used only inside (R5 to C3, and GND here) is no port", () => {
    expect(plan.ports.map((p) => p.name)).not.toContain("GND")
  })

  test("a net that another instance connects to crosses the boundary", () => {
    const withInstance = CUT_MAIN.replace("export default", `import Other from "./Other.sheet"\nexport default`).replace(
      "  </board>",
      `    <Other name="O1" connections={{ IN: "GND" }} />\n  </board>`,
    )
    expect(planCut(analyzeCircuit(withInstance), SELECTED, false).ports.map((p) => p.name)).toContain("GND")
  })

  test("a pin already on the net on its side gets no second trace", () => {
    const wired = CUT_MAIN.replace(`<trace from="R7.pin1" to="net.VIN" />`, `<trace from="R7.pin1" to="net.VIN" />\n    <trace from="R5.pin1" to="R7.pin1" />`)
    const again = planCut(analyzeCircuit(wired), SELECTED, false)
    expect(again.parentTraces).toEqual([{ pin: "R7.pin2", net: "C3_pin2" }])
    expect(again.sheetTraces).toEqual([{ pin: "C3.pin2", net: "C3_pin2" }])
  })
})

describe("the designator mapping", () => {
  test("keeps the designators unless renaming is asked for", () => {
    expect(localDesignators(["R5", "C3", "R6"], false)).toEqual([
      { from: "C3", to: "C3" },
      { from: "R5", to: "R5" },
      { from: "R6", to: "R6" },
    ])
  })

  test("renames from 1 per prefix in natural order, leaving names without a number", () => {
    expect(localDesignators(["R10", "R9", "C3", "LED"], true)).toEqual([
      { from: "C3", to: "C1" },
      { from: "LED", to: "LED" },
      { from: "R9", to: "R1" },
      { from: "R10", to: "R2" },
    ])
  })
})

describe("what refuses a selection", () => {
  const model = analyzeCircuit(CUT_MAIN)
  test("nothing selected, an unknown part, an instance, and parts of two pages", () => {
    expect(cutRefusal(model, [])).toMatch(/Select the parts/)
    expect(cutRefusal(model, ["X9"])).toMatch(/no part X9/)
    const withInstance = analyzeCircuit(`import Other from "./Other.sheet"\n${CUT_MAIN.replace("  </board>", `    <Other name="O1" connections={{}} />\n  </board>`)}`)
    expect(cutRefusal(withInstance, ["R5", "O1"])).toMatch(/O1 is a sub-sheet instance/)
    const paged = analyzeCircuit(CUT_MAIN.replace("  </board>", `    <page name="Power">\n      <resistor name="R9" />\n    </page>\n  </board>`))
    expect(cutRefusal(paged, ["R5", "R9"])).toMatch(/different pages/)
    expect(cutRefusal(model, SELECTED)).toBeUndefined()
  })
})

describe("the texts", () => {
  const model = analyzeCircuit(CUT_MAIN)

  test("the sheet holds the ports, the parts placed relative to the selection, and the wires", () => {
    const plan = planCut(model, SELECTED, true)
    const origin = cutOrigin(plan.parts)
    expect(origin).toEqual({ schX: 3, schY: 2, pcbX: 5, pcbY: 2 })
    const text = sheetSource(CUT_MAIN, model, plan, "Filter", origin)
    expect(text).toBe(`export default function Filter() {
  return (
    <sheet>
      <port name="C3_pin2" />
      <port name="D[0:3]" bus />
      <port name="VIN" />
      <resistor name="R1" resistance="1k" schX={-1} schY={-1} pcbX={-1} pcbY={0} />
      <capacitor name="C1" capacitance="100nF" schX={1} schY={-1} pcbX={1} pcbY={0} />
      <resistor name="R2" resistance="10k" schX={0} schY={1} />
      <trace from="R1.pin2" to="C1.pin1" schematicRouteHints={[{ x: 0, y: -0.5 }]} />
      <trace from="R1.pin1" to="net.VIN" />
      <trace from="R2.pin1" to="net.D1" />
      <trace from="R2.pin2" to="net.GND" />
      <trace from="C1.pin2" to="net.C3_pin2" />
    </sheet>
  )
}
`)
  })

  test("the parent loses the parts and their wires and gets the instance, connected and placed where they were", () => {
    const plan = planCut(model, SELECTED, false)
    const edits = parentEdits(plan, { sheet: "Filter", name: defaultInstanceName("Filter", model), base: 100, origin: cutOrigin(plan.parts) })
    const after = applyEdits(CUT_MAIN, edits, new Set())
    expect(after).toBe(`import Filter from "./Filter.sheet"
export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R7" resistance="2k" schX={10} schY={1} />
    <resistor name="R8" resistance="2k" schX={10} schY={3} />
    <bus name="D[0:3]" points={[{ x: 6, y: 3 }, { x: 9, y: 3 }]} />
    <Filter name="F1" connections={{ C3_pin2: "C3_pin2", "D[0:3]": "D[0:3]", VIN: "VIN" }} base={100} schX={3} schY={2} pcbX={5} pcbY={2} />
    <trace from="R7.pin1" to="net.VIN" />
    <trace from="R8.pin1" to="net.D1" />
    <trace from="R7.pin2" to="net.C3_pin2" />
  </board>
)
`)
  })
})
