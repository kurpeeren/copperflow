import { describe, expect, test } from "vitest"
import { INACTIVE_COPPER_ALPHA } from "../studio/src/pcb/copper-draw.js"
import { PALETTE } from "../studio/src/pcb/ctx.js"
import { DEFAULT_LAYERS } from "../studio/src/pcb/layers.js"
import { drawHoles, drawPourFills, drawPourOutlines, HATCH_MIN_PX, pourHatch, type PourScene } from "../studio/src/pcb/pour-draw.js"
import { POUR_FILL_ALPHA } from "../studio/src/pcb/pour-view.js"
import { recorder } from "./helpers/fake-ctx.js"

const PX = 0.1
const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
]
const SOURCE = { file: "a.tsx", line: 1, column: 1, offset: 0 }
const base = { priority: 0, minWidth: 0.25, thermal: "relief" as const, thermalWidth: 0.3, thermalGap: 0.25, source: SOURCE }
const FILLS = [
  { id: "copperpour:1", net: "n", layer: "bottom" as const, polygons: [{ outer: square(0, 0, 20), holes: [square(2, 2, 1)] }], area: 399 },
  { id: "copperpour:2", net: "n", layer: "top" as const, polygons: [{ outer: square(5, 5, 5), holes: [] }], area: 25 },
]
const BOARD = {
  outline: square(0, 0, 20),
  layers: 2 as const,
  thickness: 1.6,
  keepouts: [],
  pours: [
    { id: "copperpour:1", net: "n", layer: "bottom" as const, ...base },
    { id: "copperpour:2", net: "n", layer: "top" as const, outline: square(5, 5, 5), ...base },
  ],
}
const scene = (over: Partial<PourScene> = {}): PourScene => ({ mode: "solid", hidden: new Set(), selected: new Set(), activeLayer: "top", ...over })

describe("the pours' fills", () => {
  test("solid: each fill in its layer's colour at 35% (dimmed as its tracks are off the active layer), even-odd so the reliefs show, the active layer's last", () => {
    const { ctx, records } = recorder()
    drawPourFills(ctx, { pours: FILLS }, scene(), DEFAULT_LAYERS, PX)
    const fills = records.filter((r) => r.name === "fill")
    expect(fills.map((r) => [r.fillStyle, r.globalAlpha, r.args[0]])).toEqual([
      [PALETTE.bottomCopper, POUR_FILL_ALPHA * INACTIVE_COPPER_ALPHA, "evenodd"],
      [PALETTE.topCopper, POUR_FILL_ALPHA, "evenodd"],
    ])
    expect(POUR_FILL_ALPHA).toBe(0.35)
    // The relief's hole is a ring of its own in the same path.
    expect(records.filter((r) => r.name === "closePath")).toHaveLength(3)
  })

  test("outline only strokes the rings; hatched clips to the fill and draws lines", () => {
    const outline = recorder()
    drawPourFills(outline.ctx, { pours: FILLS }, scene({ mode: "outline" }), DEFAULT_LAYERS, PX)
    expect(outline.records.filter((r) => r.name === "fill")).toHaveLength(0)
    expect(outline.records.filter((r) => r.name === "stroke")).toHaveLength(2)
    const hatched = recorder()
    drawPourFills(hatched.ctx, { pours: FILLS }, scene({ mode: "hatched" }), DEFAULT_LAYERS, PX)
    expect(hatched.records.filter((r) => r.name === "clip").map((r) => r.args[0])).toEqual(["evenodd", "evenodd"])
    expect(hatched.records.filter((r) => r.name === "fill")).toHaveLength(0)
    expect(pourHatch(FILLS[1] as never).length).toBeGreaterThan(10)
  })

  test("a hidden layer or a pour hidden in the Layer panel is not drawn", () => {
    const { ctx, records } = recorder()
    drawPourFills(ctx, { pours: FILLS }, scene({ hidden: new Set(["copperpour:2"]) }), { ...DEFAULT_LAYERS, bottom: false }, PX)
    expect(records.filter((r) => r.name === "fill")).toHaveLength(0)
  })
})

describe("the outlines and holes", () => {
  test("a drawn outline is dashed in its layer's colour; a whole-board pour has none until selected", () => {
    const { ctx, records } = recorder()
    drawPourOutlines(ctx, { board: BOARD }, scene(), DEFAULT_LAYERS, PX, 0.01)
    expect(records.filter((r) => r.name === "stroke").map((r) => r.strokeStyle)).toEqual([PALETTE.topCopper])
  })

  test("the selected pour's outline is white with a handle on each corner; a whole board pour's has no handles", () => {
    const drawn = recorder()
    drawPourOutlines(drawn.ctx, { board: BOARD }, scene({ selected: new Set(["copperpour:2"]) }), DEFAULT_LAYERS, PX, 0.01)
    expect(drawn.records.filter((r) => r.name === "fill" && r.fillStyle === PALETTE.selection)).toHaveLength(4)
    const whole = recorder()
    drawPourOutlines(whole.ctx, { board: BOARD }, scene({ selected: new Set(["copperpour:1"]) }), DEFAULT_LAYERS, PX, 0.01)
    expect(whole.records.filter((r) => r.name === "stroke" && r.strokeStyle === PALETTE.selection)).toHaveLength(1)
    expect(whole.records.filter((r) => r.name === "fill")).toHaveLength(0)
  })

  test("a dragged outline is drawn in place of the design's, and the pour being drawn dashed white", () => {
    const { ctx, records } = recorder()
    const moved = square(6, 6, 5)
    drawPourOutlines(ctx, { board: BOARD }, scene({ outlines: new Map([["copperpour:2", moved]]), preview: square(0, 0, 2) }), DEFAULT_LAYERS, PX, 0.01)
    expect(records.find((r) => r.name === "moveTo")?.args).toEqual([6, 6])
    expect(records.filter((r) => r.name === "stroke").map((r) => r.strokeStyle)).toEqual([PALETTE.topCopper, PALETTE.selection])
  })

  test("a hole is a drill disc with a ring, white when selected, and follows the Hole layer", () => {
    const holes = [{ id: "hole:1", x: 3, y: 4, diameter: 3.2, source: SOURCE }]
    const { ctx, records } = recorder()
    drawHoles(ctx, holes, { selected: new Set(["hole:1"]) }, DEFAULT_LAYERS, PX, 0.01)
    expect(records.find((r) => r.name === "arc")?.args.slice(0, 3)).toEqual([3, 4, 1.6])
    expect(records.filter((r) => r.name === "fill").map((r) => r.fillStyle)).toEqual([PALETTE.drill])
    expect(records.filter((r) => r.name === "stroke").map((r) => r.strokeStyle)).toEqual([PALETTE.selection])
    const off = recorder()
    drawHoles(off.ctx, holes, { selected: new Set() }, { ...DEFAULT_LAYERS, hole: false }, PX, 0.01)
    expect(off.records).toHaveLength(0)
  })
})

describe("the fills' paths and hatch", () => {
  test("a fill's rings and hatch are built once per fill and zoom, then reused by every redraw", () => {
    const made: string[] = []
    class FakePath {
      constructor() {
        made.push("path")
      }
      moveTo() {}
      lineTo() {}
      closePath() {}
    }
    const original = (globalThis as { Path2D?: unknown }).Path2D
    ;(globalThis as { Path2D?: unknown }).Path2D = FakePath
    try {
      const fills = FILLS.map((fill) => ({ ...fill }))
      for (let i = 0; i < 3; i++) drawPourFills(recorder().ctx, { pours: fills }, scene({ mode: "hatched" }), DEFAULT_LAYERS, PX)
      expect(made).toHaveLength(4) // rings and hatch of each of the two fills
      drawPourFills(recorder().ctx, { pours: fills }, scene({ mode: "hatched" }), DEFAULT_LAYERS, PX * 2)
      expect(made).toHaveLength(6) // a new zoom rebuilds only the hatches
      const { ctx, records } = recorder()
      drawPourFills(ctx, { pours: fills }, scene(), DEFAULT_LAYERS, PX)
      expect(made).toHaveLength(6)
      expect(records.filter((r) => r.name === "fill").map((r) => r.args[1])).toEqual(["evenodd", "evenodd"])
    } finally {
      ;(globalThis as { Path2D?: unknown }).Path2D = original
    }
  })

  test("hatch lines stay at least 6 px apart however far out the view is zoomed", () => {
    const fill = FILLS[1] as never
    const spacing = (lines: Array<[{ x: number }, unknown]>) => (lines[1]?.[0].x ?? 0) - (lines[0]?.[0].x ?? 0)
    expect(spacing(pourHatch(fill))).toBeCloseTo(0.5)
    expect(HATCH_MIN_PX).toBe(6)
    expect(spacing(pourHatch(fill, 1))).toBeCloseTo(6)
  })
})

describe("inner-layer pours", () => {
  test("are drawn in their own colour and follow only their own eye", () => {
    const inner = [{ id: "copperpour:3", net: "n", layer: "inner1" as const, polygons: [{ outer: square(0, 0, 2), holes: [] }], area: 4 }]
    const { ctx, records } = recorder()
    drawPourFills(ctx, { pours: inner }, scene(), { ...DEFAULT_LAYERS, top: false, bottom: false }, PX)
    expect(records.filter((r) => r.name === "fill").map((r) => r.fillStyle)).toEqual([PALETTE.inner1Copper])
    const hidden = recorder()
    drawPourFills(hidden.ctx, { pours: inner }, scene({ hidden: new Set(["copperpour:3"]) }), DEFAULT_LAYERS, PX)
    expect(hidden.records.filter((r) => r.name === "fill")).toHaveLength(0)
  })
})
