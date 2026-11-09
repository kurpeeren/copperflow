import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { HIGHLIGHT_DIM } from "../studio/src/pcb/ctx.js"
import { drawDrawings, drawDrawingTexts, shownDrawings } from "../studio/src/pcb/drawing-draw.js"
import { worldToScreen } from "../studio/src/pcb/geometry.js"
import { schematicTheme } from "../studio/src/pcb/schematic-theme.js"
import { drawSchematic } from "../studio/src/pcb/schematic-draw.js"
import { recorder } from "./helpers/fake-ctx.js"

const FILE = "main.circuit.tsx"
const SOURCE = `export default () => (
  <board width="30mm" height="18mm">
    <schematicpath name="G1" points={[{ x: 0, y: 0 }, { x: 1, y: 0 }]} strokeWidth={0.05} lineStyle="dashed" />
    <schematicrect name="G2" x={2} y={0} width={1} height={1} filled={true} color="#112233" />
    <schematiccircle name="G3" x={5} y={0} radius={0.5} lineStyle="dotted" />
    <schematicarc name="G4" x={7} y={0} radius={1} startAngle={0} endAngle={90} />
    <schematictext name="G5" x={9} y={0} text="Power" fontSize={0.2} anchor="center" />
    <bus name="D[0:7]" points={[{ x: 0, y: 3 }, { x: 4, y: 3 }]} />
  </board>
)`
const design = buildDesign({ [FILE]: SOURCE }, FILE)
const drawings = design.schematic.drawings
const CAMERA = { cx: 0, cy: 0, scale: 100 }
const SIZE = { width: 400, height: 400 }
/** One device pixel in sheet units at this zoom (ratio 1). */
const DEVICE = 1 / CAMERA.scale

const strokes = (records: ReturnType<typeof recorder>["records"]) => records.filter((r) => r.name === "stroke")

describe("drawing the drawings", () => {
  test("each line and shape is stroked once, in its own colour, the theme's when it gives none, the bus in the wire colour", () => {
    const rec = recorder()
    drawDrawings(rec.ctx, drawings, DEVICE, {})
    expect(strokes(rec.records).map((r) => r.strokeStyle)).toEqual(["#000080", "#112233", "#000080", "#000080", schematicTheme.wire])
  })

  test("its line is as wide as its strokeWidth, never under a device pixel; a bus three wires wide", () => {
    const rec = recorder()
    drawDrawings(rec.ctx, drawings, DEVICE, {})
    expect(strokes(rec.records).map((r) => r.lineWidth)).toEqual([0.05, DEVICE, DEVICE, DEVICE, 0.06])
    const far = recorder()
    drawDrawings(far.ctx, drawings, 0.001, {})
    expect(strokes(far.records).map((r) => r.lineWidth)).toEqual([0.05, 0.01, 0.01, 0.01, 0.06])
  })

  test("dashed and dotted lines get dashes scaled to their width, and the dash is reset after each", () => {
    const rec = recorder()
    drawDrawings(rec.ctx, drawings, DEVICE, {})
    const dashes = rec.records.filter((r) => r.name === "setLineDash").map((r) => r.args[0])
    expect(dashes).toContainEqual([0.2, 0.15000000000000002])
    expect(dashes).toContainEqual([0, 2 * DEVICE])
    expect(dashes.at(-1)).toEqual([])
  })

  test("a filled shape is washed with its colour at 20%", () => {
    const rec = recorder()
    drawDrawings(rec.ctx, drawings, DEVICE, {})
    expect(rec.records.filter((r) => r.name === "fill").map((r) => r.fillStyle)).toEqual(["#11223333"])
  })

  test("an arc turns counter-clockwise from its start; a circle all the way round", () => {
    const rec = recorder()
    drawDrawings(rec.ctx, drawings, DEVICE, {})
    const arcs = rec.records.filter((r) => r.name === "arc").map((r) => r.args.slice(0, 5))
    expect(arcs).toEqual([[5, 0, 0.5, 0, 2 * Math.PI], [7, 0, 1, 0, Math.PI / 2]])
  })

  test("selected drawings are drawn in the selection colour; with a net lit, the rest are dimmed", () => {
    const rec = recorder()
    drawDrawings(rec.ctx, drawings, DEVICE, { selected: ["G2"], dim: true })
    const g2 = strokes(rec.records)[1]
    expect(g2?.strokeStyle).toBe(schematicTheme.selection)
    expect(g2?.globalAlpha).toBe(1)
    expect(strokes(rec.records)[0]?.globalAlpha).toBe(HIGHLIGHT_DIM)
  })

  test("a moving drawing is drawn where the move puts it", () => {
    const moved = { ...drawings[1], x: 12 } as (typeof drawings)[number]
    expect(shownDrawings(drawings, [moved])[1]).toBe(moved)
    expect(shownDrawings(drawings, undefined)).toBe(drawings)
  })
})

describe("drawing the texts", () => {
  test("a text is written upright at its anchor in the canvas font, sized by its fontSize", () => {
    const rec = recorder()
    drawDrawingTexts(rec.ctx, drawings, CAMERA, SIZE, {}, 1)
    const text = rec.records.find((r) => r.name === "fillText")
    expect(text?.args).toEqual(["Power", worldToScreen(CAMERA, SIZE, { x: 9, y: 0 }).x, worldToScreen(CAMERA, SIZE, { x: 9, y: 0 }).y])
    expect(text?.fillStyle).toBe("#000080")
    expect((rec.ctx as unknown as { font: string; textAlign: string }).font).toContain("20px")
    expect((rec.ctx as unknown as { textAlign: string }).textAlign).toBe("center")
  })

  test("it waits for the sheet's all level (designators 9 device px), then is written at a whole device pixel size on a device pixel", () => {
    const at = (scale: number, ratio: number) => {
      const rec = recorder()
      drawDrawingTexts(rec.ctx, drawings, { ...CAMERA, scale }, SIZE, {}, ratio)
      return rec.records.filter((r) => r.name === "fillText")
    }
    expect(at(50, 1)).toEqual([])
    expect(at(50, 1.15)).toHaveLength(1)
    const [text] = at(61.3, 1.25)
    const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-9
    expect([whole((text?.args[1] as number) * 1.25), whole((text?.args[2] as number) * 1.25)]).toEqual([true, true])
    expect(whole(Number(/([\d.]+)px/.exec(text?.font ?? "")?.[1]) * 1.25)).toBe(true)
  })

  test("too small to read, it is not written", () => {
    const rec = recorder()
    drawDrawingTexts(rec.ctx, drawings, { ...CAMERA, scale: 10 }, SIZE, {}, 1)
    expect(rec.records.filter((r) => r.name === "fillText")).toEqual([])
  })
})

describe("the schematic with drawings", () => {
  test("drawSchematic draws them, the selected ones in the selection colour, and their texts", () => {
    const rec = recorder()
    drawSchematic(rec.ctx, design.schematic, { camera: CAMERA, size: SIZE }, { ratio: 1, selectedDrawings: ["G1"] })
    expect(strokes(rec.records).some((r) => r.strokeStyle === schematicTheme.selection && r.lineWidth === 0.05)).toBe(true)
    expect(rec.records.some((r) => r.name === "fillText" && r.args[0] === "Power")).toBe(true)
  })
})
