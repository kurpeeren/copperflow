import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { keepNotice, keepPositions } from "../studio/src/pcb/auto-placed.js"

const CIRCUIT = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={-4} pcbY={2} schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" />
    <capacitor name="C1" capacitance="1uF" footprint="0402" pcbX={4} />
    {[1, 2].map(() => (
      <resistor name="RX" resistance="1k" footprint="0402" />
    ))}
  </board>
)`

const design = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx")
const round = (value: number) => Math.round(value * 100) / 100

describe("keepPositions", () => {
  test("writes pcbX and pcbY, rounded to 0.01, for every part auto-placed on the board", () => {
    const { edits, skipped } = keepPositions(design, "pcb")
    const r2 = design.pcb.parts.find((p) => p.component === "R2")
    expect(edits.map((e) => e.kind === "setProps" && e.part)).toEqual(["R2", "RX"])
    expect(edits[0]).toEqual({ kind: "setProps", part: "R2", props: { pcbX: round(r2?.x ?? NaN), pcbY: round(r2?.y ?? NaN) } })
    expect(skipped).toEqual([{ part: "RX~2", reason: expect.stringContaining("repeated name") }])
  })

  test("writes schX and schY for the parts auto-placed on the sheet", () => {
    const { edits } = keepPositions(design, "schematic")
    const c1 = design.schematic.symbols.find((s) => s.component === "C1")
    expect(edits.map((e) => e.kind === "setProps" && e.part)).toEqual(["R2", "C1", "RX"])
    expect(edits[1]).toEqual({ kind: "setProps", part: "C1", props: { schX: round(c1?.x ?? NaN), schY: round(c1?.y ?? NaN) } })
  })

  test("skips parts the Studio may not change, with the reason left to the caller", () => {
    const { edits, skipped } = keepPositions(design, "pcb", (name) => (name === "RX" ? "RX is read-only" : null))
    expect(edits.map((e) => e.kind === "setProps" && e.part)).toEqual(["R2"])
    expect(skipped.map((s) => s.part)).toEqual(["RX", "RX~2"])
    expect(skipped[0]?.reason).toBe("RX is read-only")
  })

  test("the notice says how many positions were kept and which parts were skipped, and why", () => {
    const plan = keepPositions(design, "pcb")
    expect(keepNotice(plan)).toBe("Kept the positions of 2 auto-placed parts. Skipped RX~2 (a repeated name cannot be addressed from the Studio).")
    expect(keepNotice({ edits: [], skipped: plan.skipped })).toMatch(/^No auto-placed part could be kept\. Skipped RX~2/)
  })

  test("a part inside an offset group gets positions relative to the group", () => {
    const grouped = buildDesign(
      {
        "main.circuit.tsx": `export default () => (
          <board width="30mm" height="18mm">
            <group pcbX={10} schX={2}>
              <resistor name="R5" resistance="1k" footprint="0402" />
            </group>
          </board>
        )`,
      },
      "main.circuit.tsx",
    )
    const onBoard = grouped.pcb.parts.find((p) => p.component === "R5")
    const onSheet = grouped.schematic.symbols.find((s) => s.component === "R5")
    expect(keepPositions(grouped, "pcb").edits).toEqual([
      { kind: "setProps", part: "R5", props: { pcbX: round((onBoard?.x ?? NaN) - 10), pcbY: round(onBoard?.y ?? NaN) } },
    ])
    expect(keepPositions(grouped, "schematic").edits).toEqual([
      { kind: "setProps", part: "R5", props: { schX: round((onSheet?.x ?? NaN) - 2), schY: round(onSheet?.y ?? NaN) } },
    ])
  })

  test("gives nothing to do when every part has a position", () => {
    const placed = buildDesign(
      { "main.circuit.tsx": `export default () => (<board width="10mm" height="10mm"><resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} /></board>)` },
      "main.circuit.tsx",
    )
    expect(keepPositions(placed, "pcb")).toEqual({ edits: [], skipped: [] })
  })
})
