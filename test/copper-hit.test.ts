import { describe, expect, test } from "vitest"
import { boxSelection } from "../studio/src/pcb/box-select.js"
import { copperAt, copperBoxes, copperGrip, copperInBox, copperShown, segmentUnder, type CopperShapes } from "../studio/src/pcb/copper-hit.js"
import { DEFAULT_LAYERS } from "../studio/src/pcb/layers.js"
import { ALL_PICKABLE } from "../studio/src/pcb/pick-filter.js"
import { selectAll, type PickContext } from "../studio/src/pcb/pick.js"
import { Selection } from "../studio/src/selection.js"

// 10 px per mm: the 6 px reach is 0.6 mm from a track's edge or a via's ring.
const SCALE = 10
const shapes: CopperShapes = {
  tracks: [
    { id: "t0001", layer: "top", width: 0.2, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
    { id: "t0002", layer: "bottom", width: 0.2, points: [{ x: 0, y: 2 }, { x: 10, y: 2 }] },
  ],
  vias: [{ id: "v0001", at: { x: 10, y: 0 }, diameter: 0.6 }],
}
const context = (over: Partial<PickContext> = {}): PickContext => ({ selection: Selection.none, armed: null, filter: ALL_PICKABLE, ...over })
const at = (x: number, y: number, over: Partial<PickContext> = {}, visible = DEFAULT_LAYERS) => copperAt(shapes, { x, y }, SCALE, visible, context(over))

describe("copperAt", () => {
  test("a via comes before the track under it", () => {
    expect(at(10, 0.2)).toEqual({ kind: "via", id: "v0001" })
  })

  test("a thin track is picked within 6 px of its centre line, and not further", () => {
    expect(at(5, 0.6)).toEqual({ kind: "track", id: "t0001" })
    expect(at(5, 0.75)).toBeUndefined()
  })

  test("the nearest track wins where two are in reach", () => {
    // 2 px per mm: the reach is 3 mm, so both tracks are in it.
    expect(copperAt(shapes, { x: 5, y: 0.8 }, 2, DEFAULT_LAYERS, context())).toEqual({ kind: "track", id: "t0001" })
    expect(copperAt(shapes, { x: 5, y: 1.2 }, 2, DEFAULT_LAYERS, context())).toEqual({ kind: "track", id: "t0002" })
  })

  test("a wide track reaches 2 px past its edge", () => {
    const wide: CopperShapes = { tracks: [{ id: "t0009", layer: "top", width: 4, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }], vias: [] }
    expect(copperAt(wide, { x: 5, y: 2.15 }, SCALE, DEFAULT_LAYERS, context())).toEqual({ kind: "track", id: "t0009" })
    expect(copperAt(wide, { x: 5, y: 2.3 }, SCALE, DEFAULT_LAYERS, context())).toBeUndefined()
  })

  test("hidden layers and Filter rows that are off are skipped", () => {
    expect(at(5, 1.5, {}, { ...DEFAULT_LAYERS, bottom: false })).toBeUndefined()
    expect(at(10, 0.2, {}, { ...DEFAULT_LAYERS, multiLayer: false })).toEqual({ kind: "track", id: "t0001" })
    expect(at(10, 0.2, { filter: { ...ALL_PICKABLE, vias: false } })).toEqual({ kind: "track", id: "t0001" })
    expect(at(5, 0, { filter: { ...ALL_PICKABLE, tracks: false } })).toBeUndefined()
    expect(at(5, 0, { armed: "note" })).toBeUndefined()
  })

  test("a layer the Layer panel has no row for (inner copper) is not shown", () => {
    expect(copperShown({ kind: "track", layer: "inner1" }, DEFAULT_LAYERS)).toBe(false)
    expect(copperShown({ kind: "track", layer: "inner1", missingLayer: "inner1" }, DEFAULT_LAYERS)).toBe(true)
    expect(copperShown({ kind: "via", missingLayer: "inner1" }, { ...DEFAULT_LAYERS, keepout: false })).toBe(false)
    expect(copperShown({ kind: "track", layer: "top" }, DEFAULT_LAYERS)).toBe(true)
    expect(copperShown({ kind: "via" }, { ...DEFAULT_LAYERS, multiLayer: false })).toBe(false)
  })
})

describe("copperGrip", () => {
  const points = shapes.tracks[0]?.points ?? []
  test("the segment under the press", () => {
    expect(copperGrip(points, { x: 5, y: 0.3 }, SCALE, false)).toEqual({ kind: "segment", index: 0 })
    expect(copperGrip(points, { x: 10.3, y: 5 }, SCALE, false)).toEqual({ kind: "segment", index: 1 })
  })

  test("a corner handle only on the track selected alone; never an end", () => {
    expect(copperGrip(points, { x: 10.1, y: 0.1 }, SCALE, true)).toEqual({ kind: "corner", index: 1 })
    expect(copperGrip(points, { x: 10.1, y: 0.1 }, SCALE, false)?.kind).toBe("segment")
    expect(copperGrip(points, { x: 0.1, y: 0 }, SCALE, true)).toEqual({ kind: "segment", index: 0 })
  })

  test("nothing when the press is off the track", () => {
    expect(copperGrip(points, { x: 5, y: 5 }, SCALE, true)).toBeUndefined()
  })
})

describe("copper in a selection box and in Select all", () => {
  test("each shown track and via has its box, its copper's width included", () => {
    expect(copperBoxes(shapes, DEFAULT_LAYERS)).toEqual([
      { kind: "track", id: "t0001", box: { minX: -0.1, minY: -0.1, maxX: 10.1, maxY: 10.1 } },
      { kind: "track", id: "t0002", box: { minX: -0.1, minY: 1.9, maxX: 10.1, maxY: 2.1 } },
      { kind: "via", id: "v0001", box: { minX: 9.7, minY: -0.3, maxX: 10.3, maxY: 0.3 } },
    ])
    expect(copperBoxes(shapes, { ...DEFAULT_LAYERS, bottom: false, multiLayer: false }).map((item) => item.id)).toEqual(["t0001"])
  })

  test("a box takes copper by the direction rule, and the Filter rows decide what it may take", () => {
    const items = copperBoxes(shapes, DEFAULT_LAYERS)
    const found = { parts: [], copper: copperInBox(items, { x: -1, y: 1 }, { x: 11, y: 3 }, "inside") }
    expect(found.copper).toEqual([{ kind: "track", id: "t0002" }])
    expect(boxSelection(found, false)(Selection.none).copper).toEqual(["t0002"])
    const touching = copperInBox(items, { x: 11, y: -1 }, { x: 9, y: 1 }, "touching").map((item) => item.id)
    expect(touching).toEqual(["t0001", "v0001"])
    const noVias = boxSelection({ parts: [], copper: copperInBox(items, { x: 11, y: -1 }, { x: 9, y: 1 }, "touching") }, true, null, undefined, { ...ALL_PICKABLE, vias: false })
    expect(noVias(Selection.none.all(["R1"])).copper).toEqual(["t0001"])
    expect(noVias(Selection.none.all(["R1"])).names).toEqual(["R1"])
  })

  test("Select all takes the copper it is given, less the kinds the Filter tab has off", () => {
    const copper = [{ kind: "track" as const, id: "t0001" }, { kind: "via" as const, id: "v0001" }]
    expect(selectAll(["R1"], undefined, undefined, [], [], [], copper)(Selection.none).copper).toEqual(["t0001", "v0001"])
    expect(selectAll(["R1"], undefined, { ...ALL_PICKABLE, tracks: false }, [], [], [], copper)(Selection.none).copper).toEqual(["v0001"])
  })
})

describe("segmentUnder: what a double click picks", () => {
  const under = (x: number, y: number, over: Partial<PickContext> = {}) => segmentUnder(shapes, { x, y }, SCALE, DEFAULT_LAYERS, context(over))

  test("the segment of the track under the pointer, by its index", () => {
    expect(under(5, 0.3)).toEqual({ id: "t0001", index: 0 })
    expect(under(10.3, 6)).toEqual({ id: "t0001", index: 1 })
    expect(under(5, 2.1)).toEqual({ id: "t0002", index: 0 })
  })

  test("nothing on a via, off the copper, or on a track the Filter tab leaves out", () => {
    expect(under(10, 0.2)).toBeUndefined()
    expect(under(5, 5)).toBeUndefined()
    expect(under(5, 0.3, { filter: { ...ALL_PICKABLE, tracks: false } })).toBeUndefined()
  })

  test("as a selection: the track alone with that segment", () => {
    const picked = under(10.3, 6)
    expect(picked && Selection.none.onlySegment(picked.id, picked.index)).toMatchObject({ copper: ["t0001"], segment: { id: "t0001", index: 1 } })
  })
})
