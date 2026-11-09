import { describe, expect, test } from "vitest"
import { tidyTrack, trackDragPath } from "../studio/src/pcb/copper-geometry.js"

const ON = { step: 1, snap: true }
const OFF = { step: 1, snap: false }
const p = (x: number, y: number) => ({ x, y })

describe("trackDragPath: a segment", () => {
  test("a square track behaves as a schematic wire: neighbours stretch, an end keeps its point and gains a segment", () => {
    const track = [p(0, 0), p(10, 0), p(10, 10)]
    expect(trackDragPath(track, { kind: "segment", index: 1 }, p(2.3, 5), ON)).toEqual([p(0, 0), p(12, 0), p(12, 10), p(10, 10)])
  })

  test("a straight track between two pads moves across, its ends stay on the pads", () => {
    expect(trackDragPath([p(0, 0), p(10, 0)], { kind: "segment", index: 0 }, p(3, 2), ON)).toEqual([p(0, 0), p(0, 2), p(10, 2), p(10, 0)])
  })

  test("a 45 degree segment moves along its normal, and its neighbours stretch along their own direction", () => {
    const track = [p(0, 0), p(5, 0), p(10, 5), p(15, 5)]
    expect(trackDragPath(track, { kind: "segment", index: 1 }, p(-1, 1), OFF)).toEqual([p(0, 0), p(3, 0), p(8, 5), p(15, 5)])
  })

  test("a move along a segment's own direction changes nothing", () => {
    const track = [p(0, 0), p(5, 0), p(10, 5), p(15, 5)]
    expect(trackDragPath(track, { kind: "segment", index: 1 }, p(1, 1), OFF)).toEqual(track)
  })

  test("a slanted segment at a track's end gains a segment there", () => {
    const track = [p(0, 0), p(5, 5), p(10, 5)]
    expect(trackDragPath(track, { kind: "segment", index: 0 }, p(1, -1), OFF)).toEqual([p(0, 0), p(1, -1), p(7, 5), p(10, 5)])
  })
})

describe("trackDragPath: a corner", () => {
  test("on a square track the corner's two segments keep their direction, as on the schematic", () => {
    const track = [p(0, 0), p(10, 0), p(10, 10), p(20, 10)]
    expect(trackDragPath(track, { kind: "corner", index: 2 }, p(2, 2), ON)).toEqual([p(0, 0), p(12, 0), p(12, 12), p(20, 12), p(20, 10)])
  })

  test("a corner beside a slanted segment goes where the pointer puts it", () => {
    expect(trackDragPath([p(0, 0), p(5, 5), p(10, 5)], { kind: "corner", index: 1 }, p(1, -1), ON)).toEqual([p(0, 0), p(6, 4), p(10, 5)])
  })
})

describe("tidyTrack", () => {
  test("drops repeated points and points in the middle of any straight run, rounds to 4 decimals, keeps both ends", () => {
    expect(tidyTrack([p(0, 0), p(0, 0), p(1, 1), p(2.000001, 2), p(2, 3)])).toEqual([p(0, 0), p(2, 2), p(2, 3)])
  })
})
