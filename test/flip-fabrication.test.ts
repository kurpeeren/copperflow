import { describe, expect, test } from "vitest"
import { analyzeCircuit, applyEdits } from "../src/core/index.js"
import { buildDesign } from "../src/engine/design.js"
import { gerberLayers } from "../src/engine/fab/layers.js"
import { pickAndPlaceCsv } from "../src/engine/fab/pick-and-place.js"
import { flipPlan } from "../studio/src/shell/board-side.js"

const SOURCE = `export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={2} pcbY={3} pcbRotation={90} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} />
  </board>
)
`

const build = (text: string) => buildDesign({ "main.circuit.tsx": text }, "main.circuit.tsx")
const count = (layers: ReturnType<typeof gerberLayers>, name: string) => layers.find((entry) => entry.name === name)?.layer.objects.length ?? 0

describe("Layout → Flip, end to end: edit, build, fabrication export", () => {
  test("the flipped part's pads go to bottom copper, mask and paste, its silk to the bottom, its pick-and-place row to Bottom", () => {
    const before = build(SOURCE)
    const plan = flipPlan(["R1"], before.pcb.parts, analyzeCircuit(SOURCE).parts, new Set())
    if ("message" in plan) throw new Error(plan.message)
    const after = build(applyEdits(SOURCE, plan.edits, new Set()))
    const part = after.pcb.parts.find((placed) => placed.component === "R1")
    expect(part?.side).toBe("bottom")
    // Mirrored: the pads sit at x reflected about the part's centre, so their x order is the other way round.
    const xs = (design: typeof before) => design.pcb.parts.find((placed) => placed.component === "R1")?.pads.map((pad) => pad.x) ?? []
    expect(xs(after).map((x) => 2 * 2 - x).sort()).toEqual([...xs(before)].sort())
    expect(part?.pads.every((pad) => pad.layers.includes("bottom") && !pad.layers.includes("top"))).toBe(true)

    const fabrication = after.rules.fabrication
    const layers = gerberLayers(after.pcb, fabrication)
    const was = gerberLayers(before.pcb, fabrication)
    for (const name of ["Cu", "Mask", "Paste"]) {
      expect([name, count(layers, `B_${name}`)]).toEqual([name, count(was, `B_${name}`) + 2])
      expect([name, count(layers, `F_${name}`)]).toEqual([name, count(was, `F_${name}`) - 2])
    }
    expect(count(layers, "B_Silkscreen")).toBeGreaterThan(count(was, "B_Silkscreen"))
    expect(count(layers, "F_Silkscreen")).toBeLessThan(count(was, "F_Silkscreen"))

    const rows = pickAndPlaceCsv(after.pcb, fabrication).trim().split("\n")
    const r1 = rows.find((row) => row.startsWith("R1,"))?.split(",") ?? []
    const r2 = rows.find((row) => row.startsWith("R2,"))?.split(",") ?? []
    expect(r1[3]).toBe("Bottom")
    expect(r2[3]).toBe("Top")
    // The bottom part's rotation is the one its mirrored footprint has on the board, as JLCPCB reads the bottom side.
    expect(Number(r1[4])).toBe(part?.rotation)
  })
})
