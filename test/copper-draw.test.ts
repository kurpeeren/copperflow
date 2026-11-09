import { describe, expect, test } from "vitest"
import { drawCopperItems, INACTIVE_COPPER_ALPHA, PENDING_ROUTE_ALPHA, type CopperScene } from "../studio/src/pcb/copper-draw.js"
import { PALETTE } from "../studio/src/pcb/ctx.js"
import { DEFAULT_LAYERS } from "../studio/src/pcb/layers.js"
import { drawPcb } from "../studio/src/pcb/pcb-draw.js"
import { recorder } from "./helpers/fake-ctx.js"

const PX = 0.1
const scene = (over: Partial<CopperScene> = {}): CopperScene => ({
  tracks: [
    { id: "t0001", net: "net.A", layer: "top", width: 0.25, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] },
    { id: "t0002", net: "net.B", layer: "bottom", width: 0.3, points: [{ x: 0, y: 2 }, { x: 5, y: 2 }] },
  ],
  vias: [{ id: "v0001", net: "net.A", at: { x: 5, y: 0 }, drill: 0.3, diameter: 0.6 }],
  selected: new Set(),
  ...over,
})
const strokes = (records: ReturnType<typeof recorder>["records"], color: string) => records.filter((r) => r.name === "stroke" && r.strokeStyle === color)

describe("drawCopperItems", () => {
  test("a route being drawn is solid in its layer's colour; one waiting for its build at 70%; with its vias", () => {
    const { ctx, records } = recorder()
    const drawing = { tracks: [{ layer: "bottom" as const, width: 0.5, points: [{ x: 0, y: 4 }, { x: 5, y: 4 }] }], vias: [{ at: { x: 5, y: 4 }, drill: 0.3, diameter: 0.6 }] }
    drawCopperItems(ctx, scene({ tracks: [], vias: [], routes: [{ drawing, alpha: 1 }, { drawing, alpha: PENDING_ROUTE_ALPHA }] }), DEFAULT_LAYERS, undefined, PX)
    expect(strokes(records, PALETTE.bottomCopper)).toMatchObject([{ lineWidth: 0.5, globalAlpha: 1 }, { lineWidth: 0.5, globalAlpha: 0.7 }])
    expect(records.filter((r) => r.name === "fill" && r.fillStyle === PALETTE.viaRing).map((r) => r.globalAlpha)).toEqual([1, 0.7])
    expect(PENDING_ROUTE_ALPHA).toBe(0.7)
  })

  test("tracks are stroked in their layer's colour at their width, the inactive layer first and dimmed to 40%", () => {
    const { ctx, records } = recorder()
    drawCopperItems(ctx, scene(), DEFAULT_LAYERS, undefined, PX)
    const bottom = strokes(records, PALETTE.bottomCopper)
    const top = strokes(records, PALETTE.topCopper)
    expect(bottom).toMatchObject([{ lineWidth: 0.3, globalAlpha: INACTIVE_COPPER_ALPHA }])
    expect(top).toMatchObject([{ lineWidth: 0.25, globalAlpha: 1 }])
    expect(records.indexOf(bottom[0] as never)).toBeLessThan(records.indexOf(top[0] as never))
    expect(INACTIVE_COPPER_ALPHA).toBe(0.4)
  })

  test("with the bottom layer active, the top is the dimmed one", () => {
    const { ctx, records } = recorder()
    drawCopperItems(ctx, scene({ activeLayer: "bottom" }), DEFAULT_LAYERS, undefined, PX)
    expect(strokes(records, PALETTE.topCopper)).toMatchObject([{ globalAlpha: INACTIVE_COPPER_ALPHA }])
    expect(strokes(records, PALETTE.bottomCopper)).toMatchObject([{ globalAlpha: 1 }])
  })

  test("a via is a ring in the plated colour with a dark hole", () => {
    const { ctx, records } = recorder()
    drawCopperItems(ctx, scene(), DEFAULT_LAYERS, undefined, PX)
    const ring = records.filter((r) => r.name === "fill" && r.fillStyle === PALETTE.viaRing)
    const hole = records.filter((r) => r.name === "arc" && r.fillStyle === PALETTE.drill)
    expect(ring).toHaveLength(1)
    expect(hole.map((r) => r.args[2])).toEqual([0.15])
  })

  test("the Layer panel's rows hide tracks, vias and the via's hole", () => {
    const { ctx, records } = recorder()
    drawCopperItems(ctx, scene(), { ...DEFAULT_LAYERS, top: false, multiLayer: false }, undefined, PX)
    expect(strokes(records, PALETTE.topCopper)).toHaveLength(0)
    expect(records.some((r) => r.fillStyle === PALETTE.viaRing)).toBe(false)
    expect(strokes(records, PALETTE.bottomCopper)).toHaveLength(1)
  })

  test("a selected track gets a white outline and the 50% wash; a hovered one an outline", () => {
    const { ctx, records } = recorder()
    drawCopperItems(ctx, scene({ selected: new Set(["t0001"]), hover: "t0002" }), DEFAULT_LAYERS, undefined, PX)
    expect(strokes(records, PALETTE.selection)).toMatchObject([{ lineWidth: 0.25 + 2 * 1.5 * PX }])
    expect(strokes(records, PALETTE.selectionFill)).toMatchObject([{ lineWidth: 0.25 }])
    expect(strokes(records, PALETTE.hover)).toMatchObject([{ lineWidth: 0.3 + 2 * 1.5 * PX }])
  })

  test("a highlighted net keeps its copper; other copper dims", () => {
    const { ctx, records } = recorder()
    drawCopperItems(ctx, scene(), DEFAULT_LAYERS, { nets: ["net.B"] }, PX)
    expect(strokes(records, PALETTE.topCopper)).toMatchObject([{ globalAlpha: 0.5 }])
    expect(strokes(records, PALETTE.bottomCopper)).toMatchObject([{ globalAlpha: INACTIVE_COPPER_ALPHA }])
  })
})

describe("drawPcb with copper", () => {
  test("the board draws the copper it is given, and none without it", () => {
    const layout = { parts: [], ratsnest: [], tracks: [], vias: [] } as unknown as Parameters<typeof drawPcb>[1]
    const view = { camera: { cx: 0, cy: 0, scale: 10 }, size: { width: 100, height: 100 } }
    const withCopper = recorder()
    drawPcb(withCopper.ctx, layout, view, { ratio: 1, copper: scene() })
    expect(strokes(withCopper.records, PALETTE.topCopper)).toHaveLength(1)
    const without = recorder()
    drawPcb(without.ctx, layout, view, { ratio: 1 })
    expect(strokes(without.records, PALETTE.topCopper)).toHaveLength(0)
  })
})
