import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { PALETTE, type Ctx } from "../studio/src/pcb/ctx.js"
import { DEFAULT_LAYERS } from "../studio/src/pcb/layers.js"
import { drawPcb } from "../studio/src/pcb/pcb-draw.js"
import { drawProto } from "../studio/src/pcb/proto-draw.js"
import { recorder, type DrawCall } from "./helpers/fake-ctx.js"

const MAIN = "main.circuit.tsx"
const records = [
  { t: "solder", id: "s1", holes: ["A1", "A2", "B2"] },
  { t: "link", id: "w1", from: "C1", to: "C4" },
  { t: "cut", id: "x1", at: "D3" },
  { t: "cut", id: "x2", between: ["E1", "E2"] },
]
const layoutOf = (kind: string) =>
  buildDesign({ [MAIN]: `export default () => (\n  <board kind="${kind}" columns={4} rows={5}>\n  </board>\n)\n`, "main.circuit.layout.json": records.map((r) => JSON.stringify(r)).join("\n") }, MAIN).pcb

function draw(kind: string, layers = DEFAULT_LAYERS): DrawCall[] {
  const { ctx, records: calls } = recorder()
  drawProto(ctx as unknown as Ctx, layoutOf(kind), layers, 0.05)
  return calls
}

const strokes = (calls: readonly DrawCall[], colour: string) => calls.filter((c) => c.name === "stroke" && c.strokeStyle === colour)
const arcs = (calls: readonly DrawCall[], colour: string, r: number) => calls.filter((c) => c.name === "arc" && c.fillStyle === colour && c.args[2] === r)

describe("the proto layers in the PCB view", () => {
  test("a perfboard draws a pad and a hole at every hole, its solder, and its links", () => {
    const calls = draw("perfboard")
    expect(arcs(calls, PALETTE.bottomCopper, 0.9)).toHaveLength(20)
    expect(arcs(calls, PALETTE.drill, 0.5)).toHaveLength(20)
    expect(strokes(calls, PALETTE.bottomCopper).filter((c) => c.lineWidth === 1.2)).toHaveLength(2)
    expect(strokes(calls, PALETTE.topCopper)).toHaveLength(1)
    // The cuts are drawn: a perfboard keeps them visible so the check's warning can be seen where it is.
    expect(strokes(calls, PALETTE.keepout)).toHaveLength(4)
  })

  test("a stripboard draws its strips less the cuts", () => {
    const calls = draw("stripboard")
    // 5 strips of 4 holes: 3 joins each, less the two at the drilled D3 and the one cut between E1 and E2.
    expect(strokes(calls, PALETTE.bottomCopper).filter((c) => c.lineWidth === 2)).toHaveLength(15 - 3)
  })

  test("follows the layer switches", () => {
    const hidden = draw("stripboard", { ...DEFAULT_LAYERS, bottom: false, top: false, hole: false })
    expect(hidden).toEqual([])
  })

  test("draws nothing on a made board, and drawPcb draws it on a proto board", () => {
    const { ctx, records: calls } = recorder()
    drawProto(ctx as unknown as Ctx, buildDesign({ [MAIN]: 'export default () => (\n  <board width="5mm" height="5mm">\n  </board>\n)\n' }, MAIN).pcb, DEFAULT_LAYERS, 0.05)
    expect(calls).toEqual([])
    const whole = recorder()
    drawPcb(whole.ctx as unknown as Ctx, layoutOf("perfboard"), { camera: { cx: 0, cy: 0, scale: 20 }, size: { width: 400, height: 300 } }, { ratio: 1 })
    expect(strokes(whole.records, PALETTE.topCopper).length).toBeGreaterThan(0)
  })
})
