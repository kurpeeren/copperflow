import { describe, expect, test } from "vitest"
import { copperRemoval, mergeShapes, moveCopper, reshapeEdit, withShapes, type CopperRecords } from "../studio/src/pcb/copper-edits.js"
import type { Point } from "../studio/src/pcb/geometry.js"

const p = (x: number, y: number) => ({ x, y })
// Pads at (0, 0) and (20, 0); a via at (10, 5) joins two tracks.
const pads = [p(0, 0), p(20, 0)]
const onPad = (point: Point) => pads.some((pad) => Math.hypot(pad.x - point.x, pad.y - point.y) < 0.5)
const records = (over: { locked?: string[] } = {}): CopperRecords => {
  const locked = (id: string) => over.locked?.includes(id) ?? false
  return {
    tracks: [
      { id: "t0001", layer: "top", points: [p(0, 0), p(0, 5), p(10, 5)], locked: locked("t0001") },
      { id: "t0002", layer: "bottom", points: [p(10, 5), p(20, 5), p(20, 0)], locked: locked("t0002") },
      { id: "t0003", layer: "top", points: [p(0, 0), p(5, 10)], locked: locked("t0003") },
    ],
    vias: [{ id: "v0001", at: p(10, 5), diameter: 0.6, locked: locked("v0001") }],
  }
}

describe("moveCopper", () => {
  test("a via moves, and the ends of the tracks on it follow; one edit per record", () => {
    const result = moveCopper(records(), ["v0001"], p(0, 2), onPad)
    expect(result.edits).toEqual([
      { kind: "setVia", id: "v0001", at: p(10, 7) },
      { kind: "setTrack", id: "t0001", points: [p(0, 0), p(0, 5), p(10, 7)] },
      { kind: "setTrack", id: "t0002", points: [p(10, 7), p(20, 5), p(20, 0)] },
    ])
    expect(result.skipped).toEqual([])
    expect(result.shapes.vias.get("v0001")).toEqual(p(10, 7))
    expect(result.shapes.tracks.get("t0002")).toEqual([p(10, 7), p(20, 5), p(20, 0)])
  })

  test("a selected track moves whole, but its ends on pads stay and gain a segment", () => {
    const result = moveCopper(records(), ["t0003"], p(1, 0), onPad)
    expect(result.edits).toEqual([{ kind: "setTrack", id: "t0003", points: [p(0, 0), p(1, 0), p(6, 10)] }])
  })

  test("a track's end on a via that does not move stays; with the via selected too, it goes along", () => {
    expect(moveCopper(records(), ["t0001"], p(0, 1), onPad).edits).toEqual([{ kind: "setTrack", id: "t0001", points: [p(0, 0), p(0, 6), p(10, 6), p(10, 5)] }])
    expect(moveCopper(records(), ["t0001", "v0001"], p(0, 1), onPad).edits).toEqual([
      { kind: "setVia", id: "v0001", at: p(10, 6) },
      { kind: "setTrack", id: "t0001", points: [p(0, 0), p(0, 6), p(10, 6)] },
      { kind: "setTrack", id: "t0002", points: [p(10, 6), p(20, 5), p(20, 0)] },
    ])
  })

  test("locked copper stays and says why; a via with a locked track on it stays too", () => {
    const track = moveCopper(records({ locked: ["t0003"] }), ["t0003"], p(1, 0), onPad)
    expect(track).toMatchObject({ edits: [], skipped: ["t0003 is locked"] })
    const via = moveCopper(records({ locked: ["t0002"] }), ["v0001"], p(1, 0), onPad)
    expect(via).toMatchObject({ edits: [], skipped: ["v0001 has the locked track t0002 on it"] })
  })

  test("a track with no end on the moving via gets no edit, even when its record is not tidy", () => {
    const untidy: CopperRecords = {
      ...records(),
      tracks: [...records().tracks, { id: "t0004", layer: "top", points: [p(0, 0), p(1, 0), p(2.123456, 0)], locked: true }],
    }
    const result = moveCopper(untidy, ["v0001"], p(0, 2), onPad)
    expect(result.edits.map((edit) => ("id" in edit ? edit.id : ""))).toEqual(["v0001", "t0001", "t0002"])
    expect(result.skipped).toEqual([])
    expect(moveCopper(untidy, ["t0003"], p(1, 0), onPad).edits.map((edit) => ("id" in edit ? edit.id : ""))).toEqual(["t0003"])
  })

  test("no move, no edits", () => {
    expect(moveCopper(records(), ["v0001"], p(0, 0), onPad).edits).toEqual([])
  })
})

describe("reshapeEdit", () => {
  test("a changed path is one setTrack; the same path or a locked track is none", () => {
    const { tracks } = records({ locked: ["t0002"] })
    const [first, second] = tracks
    if (!first || !second) throw new Error("fixture")
    expect(reshapeEdit(first, [p(0, 0), p(0, 6), p(10, 6), p(10, 5)])).toEqual({ kind: "setTrack", id: "t0001", points: [p(0, 0), p(0, 6), p(10, 6), p(10, 5)] })
    expect(reshapeEdit(first, first.points)).toBeUndefined()
    expect(reshapeEdit(second, [p(10, 5), p(20, 0)])).toEqual({ message: "t0002 is locked" })
  })
})

describe("copperRemoval", () => {
  test("each selected track and via goes in one change; locked ones stay and are named", () => {
    expect(copperRemoval(records({ locked: ["t0002"] }), ["t0001", "t0002", "v0001", "t0099"])).toEqual({
      edits: [
        { kind: "removeTrack", id: "t0001" },
        { kind: "removeVia", id: "v0001" },
      ],
      removed: ["t0001", "v0001"],
      skipped: ["t0002 is locked"],
    })
  })
})

describe("shapes in place of the records' own", () => {
  test("the later shape of a record wins, and the copper takes the shapes and keeps its other fields", () => {
    const first = { tracks: new Map([["t0001", [p(0, 0), p(1, 1)]]]), vias: new Map([["v0001", p(1, 1)]]) }
    const second = { tracks: new Map([["t0001", [p(0, 0), p(2, 2)]]]), vias: new Map() }
    const merged = mergeShapes(first, second)
    expect(merged.tracks.get("t0001")).toEqual([p(0, 0), p(2, 2)])
    expect(merged.vias.get("v0001")).toEqual(p(1, 1))
    const shown = withShapes(records(), merged)
    expect(shown.tracks[0]).toMatchObject({ id: "t0001", layer: "top", points: [p(0, 0), p(2, 2)] })
    expect(shown.tracks[1]?.points).toEqual([p(10, 5), p(20, 5), p(20, 0)])
    expect(shown.vias[0]).toMatchObject({ id: "v0001", at: p(1, 1), diameter: 0.6 })
  })
})
