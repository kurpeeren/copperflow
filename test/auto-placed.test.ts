import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { buildDesign } from "../src/engine/design.js"
import { autoPlacedParts, keepNotice, keepPositions, NOTHING_TO_TIDY, NOT_BUILT, TIDY_SUMMARY, tidyNotice, tidyPlan, tidyReason } from "../studio/src/pcb/auto-placed.js"

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

/** A chip with a decoupling capacitor, which the engine stands upright beside it. */
const REGULATOR = `export default () => (
  <board width="30mm" height="18mm">
    <chip name="U1" pinLabels={{ pin1: "VIN", pin2: "GND", pin3: "VOUT" }} pinAttributes={{ pin1: { requiresPower: true }, pin2: { requiresGround: true }, pin3: { providesPower: true } }} />
    <capacitor name="C1" capacitance="1uF" />
    <trace from="U1.VIN" to="net.VIN" />
    <trace from="C1.pin1" to="net.VIN" />
    <trace from="C1.pin2" to="net.GND" />
    <trace from="U1.GND" to="net.GND" />
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

  test("writes schRotation too for a part the engine turned, so it is kept as it stands", () => {
    const turned = buildDesign({ "main.circuit.tsx": REGULATOR }, "main.circuit.tsx")
    const c1 = turned.schematic.symbols.find((s) => s.component === "C1")
    expect(c1?.rotation).not.toBe(0)
    const edit = keepPositions(turned, "schematic").edits.find((e) => e.kind === "setProps" && e.part === "C1")
    expect(edit).toEqual({ kind: "setProps", part: "C1", props: { schX: round(c1?.x ?? NaN), schY: round(c1?.y ?? NaN), schRotation: c1?.rotation } })
  })

  test("writes the rotation it is drawn with, 0 included, when the source has a rotation the engine ignored, in both views", () => {
    const text = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R9" resistance="1k" footprint="0402" schRotation={90} pcbRotation={90} />
  </board>
)`
    const turned = buildDesign({ "main.circuit.tsx": text }, "main.circuit.tsx")
    const source = { model: analyzeCircuit(text) }
    const r9 = { sch: turned.schematic.symbols.find((s) => s.component === "R9"), pcb: turned.pcb.parts.find((p) => p.component === "R9") }
    expect([r9.sch?.rotation, r9.pcb?.rotation]).toEqual([0, 0])
    expect(keepPositions(turned, "schematic", undefined, source).edits).toEqual([
      { kind: "setProps", part: "R9", props: { schX: round(r9.sch?.x ?? NaN), schY: round(r9.sch?.y ?? NaN), schRotation: 0 } },
    ])
    expect(keepPositions(turned, "pcb", undefined, source).edits).toEqual([
      { kind: "setProps", part: "R9", props: { pcbX: round(r9.pcb?.x ?? NaN), pcbY: round(r9.pcb?.y ?? NaN), pcbRotation: 0 } },
    ])
    expect(tidyPlan(turned, undefined, source)).toEqual(keepPositions(turned, "schematic", undefined, source))
  })

  test("gives nothing to do when every part has a position", () => {
    const placed = buildDesign(
      { "main.circuit.tsx": `export default () => (<board width="10mm" height="10mm"><resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} /></board>)` },
      "main.circuit.tsx",
    )
    expect(keepPositions(placed, "pcb")).toEqual({ edits: [], skipped: [] })
  })
})

describe("Layout → Tidy sheet", () => {
  test("writes the positions, and rotations, of the parts Studio placed on the sheet, and of no other", () => {
    const placedHere = autoPlacedParts(design, "schematic")
    const { edits } = tidyPlan(design)
    const parts = edits.map((e) => (e.kind === "setProps" ? e.part : ""))
    expect(parts).toEqual(["R2", "C1", "RX"])
    expect(parts.every((part) => placedHere.has(part))).toBe(true)
    expect(parts).not.toContain("R1")
    expect(edits.every((e) => e.kind === "setProps" && Object.keys(e.props).every((key) => key.startsWith("sch")))).toBe(true)
    expect(tidyPlan(design)).toEqual(keepPositions(design, "schematic"))
  })

  test("is one entry in the history, and says what it wrote", () => {
    expect(TIDY_SUMMARY).toBe("Tidy sheet")
    expect(tidyNotice(tidyPlan(design))).toBe("Tidied the sheet: wrote the positions of 3 parts Studio placed. Skipped RX~2 (a repeated name cannot be addressed from the Studio).")
    expect(tidyNotice({ edits: [], skipped: [] })).toBe("Tidied the sheet: no part Studio placed could be written.")
  })

  test("is off, with the reason, when nothing on the sheet was placed by Studio or there is no build yet", () => {
    const placed = buildDesign({ "main.circuit.tsx": `export default () => (<board width="10mm" height="10mm"><resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} /></board>)` }, "main.circuit.tsx")
    expect(tidyReason(design)).toBeNull()
    expect(tidyReason(placed)).toBe(NOTHING_TO_TIDY)
    expect(NOTHING_TO_TIDY).toBe("Every part on the sheet has a position of its own")
    expect(tidyReason(undefined)).toBe(NOT_BUILT)
  })
})

describe("autoPlacedParts", () => {
  test("names the parts the engine placed in the view", () => {
    expect([...autoPlacedParts(design, "schematic")]).toEqual(["R2", "C1", "RX", "RX~2"])
    expect([...autoPlacedParts(design, "pcb")]).toEqual(["R2", "RX", "RX~2"])
    expect(autoPlacedParts(undefined, "pcb").size).toBe(0)
  })
})
