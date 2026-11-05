import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { groundSymbol } from "../src/engine/symbols/index.js"
import { SCHEMATIC_PALETTE, drawSchematic, sheetBoxes, type SchematicDrawOptions } from "../studio/src/pcb/schematic-draw.js"
import { recorder } from "./helpers/fake-ctx.js"

const CIRCUIT = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.GND" />
    <trace from=".R1 > .pin2" to=".R2 > .pin2" />
  </board>
)`

const design = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx")
const layout = design.schematic
const VIEW = { camera: { cx: 1.5, cy: 0, scale: 100 }, size: { width: 800, height: 600 } }

function draw(options: Partial<SchematicDrawOptions> = {}) {
  const rec = recorder()
  drawSchematic(rec.ctx as never, layout, VIEW, { ratio: 1, ...options })
  return rec
}

describe("drawSchematic", () => {
  test("draws a resistor polyline and both pin numbers", () => {
    const { calls, records } = draw()
    expect(calls).toContain("lineTo")
    const texts = records.filter((r) => r.name === "fillText").map((r) => r.args[0])
    expect(texts).toEqual(expect.arrayContaining(["1", "2"]))
  })

  test("draws the reference designators", () => {
    const texts = draw().records.filter((r) => r.name === "fillText").map((r) => r.args[0])
    expect(texts).toEqual(expect.arrayContaining(["R1", "R2"]))
  })

  test("an active pin is drawn in activePort", () => {
    const { records } = draw({ activePins: ["R1.pin1"] })
    expect(records.some((r) => r.name === "fill" && r.fillStyle === SCHEMATIC_PALETTE.activePort)).toBe(true)
    expect(draw().records.some((r) => r.fillStyle === SCHEMATIC_PALETTE.activePort)).toBe(false)
  })

  test("showPins marks every pin", () => {
    const fills = (rec: ReturnType<typeof draw>) => rec.records.filter((r) => r.name === "fill" && r.fillStyle === SCHEMATIC_PALETTE.port).length
    expect(fills(draw({ showPins: true }))).toBe(4)
    expect(fills(draw())).toBe(0)
  })

  test("a ground label draws the ground shape", () => {
    expect(layout.labels.some((l) => l.style === "ground")).toBe(true)
    const labels = layout.labels.filter((l) => l.style === "ground").length
    const strokes = draw().records.filter((r) => r.name === "stroke" && r.strokeStyle === SCHEMATIC_PALETTE.netLabel)
    expect(strokes.length).toBe(labels * groundSymbol().length)
  })

  test("a pending wire is drawn dashed", () => {
    const rec = draw({
      pending: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    })
    expect(rec.records.some((r) => r.name === "setLineDash" && (r.args[0] as number[]).length > 0)).toBe(true)
  })

  test("the moving part is drawn shifted", () => {
    const r1 = layout.symbols.find((s) => s.component === "R1")
    const moved = draw({ moving: { component: "R1", by: { x: 1, y: 0 } } }).records.filter((r) => r.name === "translate")
    expect(moved.some((r) => r.args[0] === (r1?.x ?? 0) + 1)).toBe(true)
  })
})

describe("sheetBoxes", () => {
  test("gives one box per symbol, named by its component", () => {
    const boxes = sheetBoxes(layout)
    expect(boxes.map((b) => b.name).sort()).toEqual(["R1", "R2"])
    const r2 = boxes.find((b) => b.name === "R2")
    const x = layout.symbols.find((s) => s.component === "R2")?.x ?? 0
    expect(r2?.box.minX).toBeLessThan(x)
    expect(r2?.box.maxX).toBeGreaterThan(x)
  })
})
