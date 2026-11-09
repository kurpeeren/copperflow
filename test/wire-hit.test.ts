import { describe, expect, test } from "vitest"
import { cornerAt, distanceToSegment, segmentAt, WIRE_REACH_PX, wireAt, wireHandles } from "../studio/src/pcb/wire-hit.js"

const p = (x: number, y: number) => ({ x, y })
// An L from (0,0) right to (2,0), then up to (2,3); a straight wire below it.
const L = [p(0, 0), p(2, 0), p(2, 3)]
const WIRES = [
  { id: "wire:L", points: L },
  { id: "wire:low", points: [p(0, -1), p(4, -1)] },
]

describe("the wire under the pointer", () => {
  test("a pointer within the reach of a segment is on it, measured square to the segment", () => {
    expect(distanceToSegment(p(1, 0.05), p(0, 0), p(2, 0))).toBeCloseTo(0.05)
    expect(distanceToSegment(p(3, 0), p(0, 0), p(2, 0))).toBeCloseTo(1)
    expect(segmentAt(L, p(1, 0.05), 0.1)).toBe(0)
    expect(segmentAt(L, p(2.05, 2), 0.1)).toBe(1)
    expect(segmentAt(L, p(1, 0.2), 0.1)).toBeUndefined()
  })

  test("of two segments in reach, the nearer one is taken", () => {
    expect(segmentAt(L, p(1.95, 0.02), 0.1)).toBe(0)
    expect(segmentAt(L, p(1.98, 0.08), 0.1)).toBe(1)
  })

  test("the nearest wire within reach, else none", () => {
    expect(wireAt(WIRES, p(1, -0.03), 0.1)).toBe("wire:L")
    expect(wireAt(WIRES, p(1, -0.97), 0.1)).toBe("wire:low")
    expect(wireAt(WIRES, p(1, -0.5), 0.1)).toBeUndefined()
    expect(wireAt([], p(0, 0), 0.1)).toBeUndefined()
  })

  test("the reach is 6 screen pixels, so it shrinks in sheet units as the camera zooms in", () => {
    expect(WIRE_REACH_PX).toBe(6)
    const at = p(1, 0.05)
    expect(wireAt(WIRES, at, WIRE_REACH_PX / 100)).toBe("wire:L")
    expect(wireAt(WIRES, at, WIRE_REACH_PX / 200)).toBeUndefined()
  })

  test("a wire with a single point has no segment to hit", () => {
    expect(wireAt([{ id: "dot", points: [p(0, 0)] }], p(0, 0), 1)).toBeUndefined()
  })
})

describe("the handles of a selected wire", () => {
  test("its corners take square handles; its two ends are drawn apart, as they cannot be dragged", () => {
    expect(wireHandles(L)).toEqual({ corners: [p(2, 0)], ends: [p(0, 0), p(2, 3)] })
    expect(wireHandles([p(0, 0), p(4, 0)])).toEqual({ corners: [], ends: [p(0, 0), p(4, 0)] })
    expect(wireHandles([])).toEqual({ corners: [], ends: [] })
  })

  test("a corner handle is hit inside its square; the ends have none", () => {
    expect(cornerAt(L, p(2.04, -0.04), 0.05)).toBe(1)
    expect(cornerAt(L, p(2.08, 0), 0.05)).toBeUndefined()
    expect(cornerAt(L, p(0, 0), 0.05)).toBeUndefined()
    expect(cornerAt(L, p(2, 3), 0.05)).toBeUndefined()
  })
})
