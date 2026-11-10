import { describe, expect, test } from "vitest"
import { segmentRemoval } from "../src/core/track-split.js"

const pt = (x: number, y: number) => ({ x, y })
const track = { id: "t0001", net: "VBUS", layer: "top" as const, width: 0.3, points: [pt(0, 0), pt(5, 0), pt(5, 5), pt(10, 5)], locked: false }

describe("segmentRemoval", () => {
  test("the first segment: the track keeps the run after it", () => {
    expect(segmentRemoval(track, 0)).toEqual({ edits: [{ kind: "setTrack", id: "t0001", points: [pt(5, 0), pt(5, 5), pt(10, 5)] }] })
  })

  test("a middle segment: the track keeps the run before it and the run after it is a new track with its net, layer and width", () => {
    expect(segmentRemoval(track, 1)).toEqual({
      edits: [
        { kind: "setTrack", id: "t0001", points: [pt(0, 0), pt(5, 0)] },
        { kind: "addTrack", net: "VBUS", layer: "top", width: 0.3, points: [pt(5, 5), pt(10, 5)] },
      ],
    })
  })

  test("the last segment: the track keeps the run before it", () => {
    expect(segmentRemoval(track, 2)).toEqual({ edits: [{ kind: "setTrack", id: "t0001", points: [pt(0, 0), pt(5, 0), pt(5, 5)] }] })
  })

  test("the one segment of a two-point track removes the track", () => {
    expect(segmentRemoval({ ...track, points: [pt(0, 0), pt(5, 0)] }, 0)).toEqual({ edits: [{ kind: "removeTrack", id: "t0001" }] })
  })

  test("a track with no net gives a new run with no net", () => {
    const { net: _net, ...bare } = track
    const result = segmentRemoval(bare, 1)
    expect("edits" in result && result.edits[1]).toEqual({ kind: "addTrack", layer: "top", width: 0.3, points: [pt(5, 5), pt(10, 5)] })
  })

  test("refuses a segment the track does not have, and a locked track", () => {
    expect(segmentRemoval(track, 3)).toEqual({ message: "t0001 has no segment 3; it has 3 (0 to 2)" })
    expect(segmentRemoval(track, -1)).toEqual({ message: "t0001 has no segment -1; it has 3 (0 to 2)" })
    expect(segmentRemoval(track, 1.5)).toEqual({ message: "t0001 has no segment 1.5; it has 3 (0 to 2)" })
    expect(segmentRemoval({ ...track, locked: true }, 1)).toEqual({ message: "t0001 is locked" })
  })

  test("leaves the track it was given as it was", () => {
    const points = track.points.map((p) => ({ ...p }))
    segmentRemoval(track, 1)
    expect(track.points).toEqual(points)
  })
})
