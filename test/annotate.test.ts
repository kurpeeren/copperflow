import { describe, expect, test } from "vitest"
import { applyEdits, EditError } from "../src/core/index.js"
import { annotatePlan } from "../studio/src/shell/annotate.js"

const SOURCE = `export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R3" resistance="1k" />
    <resistor name="R1" resistance="2k" />
    <capacitor name="C1" capacitance="1u" />
    <trace from="R3.pin1" to="R1.pin2" />
    <trace from=".R1 > .pin1" to="net.GND" />
  </board>
)
`

describe("the renameParts edit", () => {
  test("swaps names in one pass and the trace ends follow", () => {
    const next = applyEdits(SOURCE, [{ kind: "renameParts", mapping: [{ from: "R3", to: "R1" }, { from: "R1", to: "R3" }] }], new Set())
    expect(next).toContain('<resistor name="R1" resistance="1k" />')
    expect(next).toContain('<resistor name="R3" resistance="2k" />')
    expect(next).toContain('<trace from="R1.pin1" to="R3.pin2" />')
    expect(next).toContain('<trace from="R3.pin1" to="net.GND" />')
    expect(next).toContain('<capacitor name="C1"')
  })

  test("refuses a locked part and a name another part keeps", () => {
    expect(() => applyEdits(SOURCE, [{ kind: "renameParts", mapping: [{ from: "R3", to: "R2" }] }], new Set(["R3"]))).toThrow(EditError)
    expect(() => applyEdits(SOURCE, [{ kind: "renameParts", mapping: [{ from: "R3", to: "R1" }] }], new Set())).toThrow(/R1 would name two things/)
  })
})

describe("Design → Annotate designators", () => {
  test("numbers each prefix top to bottom, then left to right, page by page", () => {
    const plan = annotatePlan([
      { name: "R7", renamable: true, at: { page: 0, x: 0, y: 1 } },
      { name: "R2", renamable: true, at: { page: 0, x: 0, y: 3 } },
      { name: "R5", renamable: true, at: { page: 1, x: 0, y: 9 } },
      { name: "C4", renamable: true, at: { page: 0, x: 2, y: 0 } },
      { name: "C9", renamable: true, at: { page: 0, x: 1, y: 0 } },
    ])
    expect(plan).toEqual({
      edit: { kind: "renameParts", mapping: [{ from: "R2", to: "R1" }, { from: "R7", to: "R2" }, { from: "R5", to: "R3" }, { from: "C9", to: "C1" }, { from: "C4", to: "C2" }] },
      summary: "annotate designators: R2 → R1, R7 → R2, R5 → R3, C9 → C1 and 1 more",
    })
  })

  test("a locked part keeps its name and its number is skipped", () => {
    const plan = annotatePlan([
      { name: "R1", renamable: false },
      { name: "R9", renamable: true, at: { page: 0, x: 0, y: 0 } },
    ])
    expect(plan).toMatchObject({ edit: { mapping: [{ from: "R9", to: "R2" }] } })
    expect(annotatePlan([{ name: "R1", renamable: true }])).toEqual({ message: "Every designator is already numbered in order." })
  })
})
