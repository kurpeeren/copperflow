import { describe, expect, test } from "vitest"
import { segmentDeletion } from "../studio/src/pcb/copper-edits.js"
import { followCopperDrag, keepSegment, segmentAfterDrag, startCopperDrag } from "../studio/src/pcb/copper-gesture.js"
import { filletTrack } from "../studio/src/pcb/fillet.js"
import { segmentChecked, segmentFits, segmentOn, Selection } from "../studio/src/selection.js"

// A selected segment remembers its two ends; once the track's points change under it (a fillet, an undo after a drag,
// a build landing) the segment is dropped back to the whole track, and Delete refuses a segment whose ends moved.
const p = (x: number, y: number) => ({ x, y })
const POINTS = [p(0, 0), p(10, 0), p(10, 10), p(20, 10)]
const track = { id: "t0001", net: "net.A", named: "VBUS", layer: "top" as const, width: 0.25, points: POINTS, locked: false }
const CHANGED = "the track changed; select the segment again"

describe("segmentOn and segmentFits", () => {
  test("a segment carries its index and its two ends", () => {
    expect(segmentOn(track, 2)).toEqual({ id: "t0001", index: 2, from: p(10, 10), to: p(20, 10) })
    expect(segmentOn(track, 3)).toBeUndefined()
  })

  test("it fits points that still have its ends at its index, and no others", () => {
    const segment = segmentOn(track, 2)
    if (!segment) throw new Error("no segment")
    expect(segmentFits(segment, POINTS)).toBe(true)
    expect(segmentFits(segment, [p(0, 0), p(10, 0), p(10, 10), p(20, 11)])).toBe(false)
    expect(segmentFits(segment, [p(0, 0), p(10, 10), p(20, 10)])).toBe(false)
  })

  test("the same segment with other ends is a new selection", () => {
    const segment = segmentOn(track, 2)
    if (!segment) throw new Error("no segment")
    const selected = Selection.none.onlySegment(segment)
    expect(selected.onlySegment({ ...segment })).toBe(selected)
    expect(selected.onlySegment({ ...segment, to: p(21, 10) })).not.toBe(selected)
  })
})

describe("a fillet with a segment selected, then Delete", () => {
  const segment = segmentOn(track, 2)
  if (!segment) throw new Error("no segment")
  const selected = Selection.none.onlySegment(segment)
  const filleted = { ...track, points: filletTrack(POINTS, 1, track.width).points }

  test("the fillet puts other points at the index, so the segment is dropped and the whole track stays selected", () => {
    expect(filleted.points.length).toBeGreaterThan(POINTS.length)
    const after = segmentChecked(selected, [filleted])
    expect(after.copper).toEqual(["t0001"])
    expect(after.segment).toBeUndefined()
  })

  test("Delete with the stale segment refuses instead of removing an arc piece", () => {
    expect(segmentDeletion(filleted, segment)).toEqual({ message: CHANGED })
  })

  test("while the points are the same the segment stays, and the same selection comes back", () => {
    expect(segmentChecked(selected, [track])).toBe(selected)
    expect(segmentChecked(Selection.none.onlyCopper("t0001"), [filleted])).toEqual(Selection.none.onlyCopper("t0001"))
  })
})

describe("a segment dragged, then undone, then Delete", () => {
  const segment = segmentOn(track, 1)
  if (!segment) throw new Error("no segment")
  const selected = Selection.none.onlySegment(segment)
  const press = startCopperDrag({ kind: "track", id: "t0001" }, { tracks: [track], vias: [] }, { world: p(10.1, 5), point: p(10.1, 5), scale: 10, sole: true, width: track.width })
  if (!press) throw new Error("no drag")
  const moved = followCopperDrag(keepSegment(press, selected.segment), p(3, 0), { step: 1, snap: true }, () => undefined)
  const dragged = segmentAfterDrag(moved)?.(selected)

  test("after the drag the moved segment is selected with its new ends, which fit the new path", () => {
    expect(dragged?.segment).toEqual({ id: "t0001", index: 1, from: p(13, 0), to: p(13, 10) })
    expect(dragged && segmentChecked(dragged, [{ ...track, points: moved.path ?? [] }])).toBe(dragged)
  })

  test("undo brings the old path back: the segment no longer fits and is dropped, and Delete refuses it", () => {
    if (!dragged?.segment) throw new Error("no segment")
    expect(segmentChecked(dragged, [track]).segment).toBeUndefined()
    expect(segmentDeletion(track, dragged.segment)).toEqual({ message: CHANGED })
  })
})
