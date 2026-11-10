import { describe, expect, test } from "vitest"
import { chordStep, filletTrack, MAX_CHORD_SAG, MAX_CHORD_STEP, straightenTrack } from "../../src/engine/fillet.js"
import type { Point } from "../../src/engine/model.js"

const pt = (x: number, y: number): Point => ({ x, y })
const DEG = Math.PI / 180

/** The distance from a point to a circle's rim. */
const offRim = (p: Point, centre: Point, radius: number) => Math.abs(Math.hypot(p.x - centre.x, p.y - centre.y) - radius)

/** The widest gap between a chord's middle and the arc it stands for. */
function worstSag(points: readonly Point[], centre: Point, radius: number): number {
  let worst = 0
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1] as Point, points[i] as Point]
    const mid = pt((a.x + b.x) / 2, (a.y + b.y) / 2)
    worst = Math.max(worst, radius - Math.hypot(mid.x - centre.x, mid.y - centre.y))
  }
  return worst
}

const near = (a: readonly Point[], b: readonly Point[], within = 0.001) =>
  a.length === b.length && a.every((p, i) => Math.hypot(p.x - (b[i] as Point).x, p.y - (b[i] as Point).y) <= within)

describe("chordStep", () => {
  test("is at most 15 degrees and keeps a chord within 0.005 mm of its arc", () => {
    expect(MAX_CHORD_STEP).toBeCloseTo(15 * DEG, 12)
    expect(MAX_CHORD_SAG).toBe(0.005)
    for (const radius of [0.05, 0.25, 0.5, 1, 2, 5, 20, 100]) {
      const step = chordStep(radius)
      expect(step).toBeLessThanOrEqual(MAX_CHORD_STEP + 1e-12)
      expect(radius * (1 - Math.cos(step / 2))).toBeLessThanOrEqual(MAX_CHORD_SAG + 1e-12)
    }
    // A small arc is held by the angle, a large one by the gap.
    expect(chordStep(0.1)).toBeCloseTo(MAX_CHORD_STEP, 12)
    expect(chordStep(1)).toBeLessThan(MAX_CHORD_STEP)
  })
})

describe("filletTrack", () => {
  const square = [pt(0, 0), pt(10, 0), pt(10, 10)]

  test.each([0.5, 1, 2, 4])("rounds a 90 degree corner at radius %s on the arc, tangent to both legs", (radius) => {
    const { points, square: left, rounded } = filletTrack(square, radius, 0.25)
    expect(left).toEqual([])
    expect(rounded).toBe(1)
    expect(points[0]).toEqual(pt(0, 0))
    expect(points.at(-1)).toEqual(pt(10, 10))
    const arc = points.slice(1, -1)
    expect(arc[0]?.x).toBeCloseTo(10 - radius, 6)
    expect(arc[0]?.y).toBeCloseTo(0, 6)
    expect(arc.at(-1)?.x).toBeCloseTo(10, 6)
    expect(arc.at(-1)?.y).toBeCloseTo(radius, 6)
    const centre = pt(10 - radius, radius)
    for (const p of arc) expect(offRim(p, centre, radius)).toBeLessThan(1e-5)
    expect(worstSag(arc, centre, radius)).toBeLessThanOrEqual(MAX_CHORD_SAG + 1e-6)
    expect(arc.length - 1).toBe(Math.ceil((90 * DEG) / chordStep(radius) - 1e-9))
  })

  test.each([0.5, 1, 3])("rounds a 45 degree corner at radius %s", (radius) => {
    const track = [pt(0, 0), pt(10, 0), pt(20, 10)]
    const { points, square: left } = filletTrack(track, radius, 0.25)
    expect(left).toEqual([])
    const t = radius * Math.tan(22.5 * DEG)
    const arc = points.slice(1, -1)
    expect(arc[0]?.x).toBeCloseTo(10 - t, 6)
    const end = arc.at(-1) as Point
    expect(end.x).toBeCloseTo(10 + t / Math.SQRT2, 6)
    expect(end.y).toBeCloseTo(t / Math.SQRT2, 6)
    const centre = pt(10 - t, radius)
    for (const p of arc) expect(offRim(p, centre, radius)).toBeLessThan(1e-5)
    expect(worstSag(arc, centre, radius)).toBeLessThanOrEqual(MAX_CHORD_SAG + 1e-6)
  })

  test("turns the other way just as well", () => {
    const { points } = filletTrack([pt(0, 0), pt(10, 0), pt(10, -10)], 1, 0.25)
    const centre = pt(9, -1)
    for (const p of points.slice(1, -1)) expect(offRim(p, centre, 1)).toBeLessThan(1e-5)
  })

  test("raises a radius under the track's width to the width", () => {
    const { points } = filletTrack(square, 0.1, 0.5)
    expect(points[1]?.x).toBeCloseTo(9.5, 6)
  })

  test("leaves a corner square when a leg is shorter than the radius needs, with the reason", () => {
    const { points, square: left, rounded } = filletTrack([pt(0, 0), pt(10, 0), pt(10, 0.5)], 1, 0.25)
    expect(rounded).toBe(0)
    expect(points).toEqual([pt(0, 0), pt(10, 0), pt(10, 0.5)])
    expect(left).toEqual([{ index: 1, at: pt(10, 0), reason: "too short" }])
  })

  test("shares a leg between two corners: the first takes what it needs, the second is too short", () => {
    const track = [pt(0, 0), pt(10, 0), pt(10, 1.5), pt(20, 1.5)]
    const { square: left, rounded } = filletTrack(track, 1, 0.25)
    expect(rounded).toBe(1)
    expect(left).toEqual([{ index: 2, at: pt(10, 1.5), reason: "too short" }])
  })

  test("asks the guard about each arc and leaves a corner square with its answer", () => {
    const seen: Point[] = []
    const guard = (corner: Point, arc: readonly Point[]) => {
      seen.push(corner)
      expect(arc.length).toBeGreaterThan(2)
      return corner.y === 10 ? "too close to GND" : undefined
    }
    const { square: left, rounded } = filletTrack([pt(0, 0), pt(10, 0), pt(10, 10), pt(20, 10)], 1, 0.25, guard)
    expect(seen).toEqual([pt(10, 0), pt(10, 10)])
    expect(rounded).toBe(1)
    expect(left).toEqual([{ index: 2, at: pt(10, 10), reason: "too close to GND" }])
  })

  test("is idempotent: rounded corners stay as they are and square ones stay square", () => {
    const track = [pt(0, 0), pt(10, 0), pt(10, 10), pt(15, 15), pt(15, 15.4), pt(30, 15.4)]
    const once = filletTrack(track, 1, 0.25)
    const twice = filletTrack(once.points, 1, 0.25)
    expect(twice.points).toEqual(once.points)
    expect(twice.rounded).toBe(0)
    expect(twice.square.map((c) => c.reason)).toEqual(once.square.map((c) => c.reason))
  })

  test("a straight track or one of two points has nothing to round", () => {
    expect(filletTrack([pt(0, 0), pt(5, 0)], 1, 0.25)).toEqual({ points: [pt(0, 0), pt(5, 0)], rounded: 0, square: [] })
    expect(filletTrack([pt(0, 0), pt(5, 0), pt(9, 0)], 1, 0.25).rounded).toBe(0)
  })
})

describe("straightenTrack", () => {
  const tracks: Record<string, Point[]> = {
    "one 90 degree corner": [pt(0, 0), pt(10, 0), pt(10, 10)],
    "one 45 degree corner": [pt(0, 0), pt(10, 0), pt(20, 10)],
    "a staircase": [pt(0, 0), pt(5, 0), pt(5, 5), pt(10, 5), pt(15, 10), pt(15, 20)],
    "both ways": [pt(1.2, -3.4), pt(8.7, -3.4), pt(8.7, 4.15), pt(2.05, 10.8), pt(2.05, 18)],
  }

  test.each(Object.entries(tracks))("gives back %s after a fillet, within 0.001 mm", (_, track) => {
    for (const radius of [0.3, 1, 2]) {
      const rounded = filletTrack(track, radius, 0.25)
      expect(rounded.square).toEqual([])
      const back = straightenTrack(rounded.points)
      expect(back.straightened).toBe(track.length - 2)
      expect(near(back.points, track)).toBe(true)
    }
  })

  test("is idempotent and leaves a square track alone", () => {
    const track = tracks["a staircase"] as Point[]
    expect(straightenTrack(track)).toEqual({ points: track, straightened: 0, round: [] })
    const once = straightenTrack(filletTrack(track, 1, 0.25).points)
    expect(straightenTrack(once.points)).toEqual({ points: once.points, straightened: 0, round: [] })
  })

  test("a turn too slight for straighten to find is no corner for fillet either; 0.1 degree comes back", () => {
    for (const degrees of [0.05, 0.07, 0.1, 0.2, 0.3, 0.5]) {
      const a = degrees * DEG
      const track = [pt(0, 0), pt(10, 0), pt(10 + 10 * Math.cos(a), 10 * Math.sin(a))]
      const rounded = filletTrack(track, 1, 0.25)
      expect([degrees, near(straightenTrack(rounded.points).points, track)]).toEqual([degrees, true])
    }
  })

  test("asks the guard about each run before putting its corner back", () => {
    const rounded = filletTrack([pt(0, 0), pt(10, 0), pt(10, 10), pt(20, 10)], 1, 0.25).points
    const seen: Point[] = []
    const back = straightenTrack(rounded, (corner, arc) => {
      seen.push(corner)
      expect(arc.length).toBeGreaterThan(2)
      return corner.y === 10 ? "too close to GND" : undefined
    })
    expect(seen).toEqual([pt(10, 0), pt(10, 10)])
    expect(back.straightened).toBe(1)
    expect(back.round).toEqual([{ at: pt(10, 10), reason: "too close to GND" }])
    expect(straightenTrack(back.points).straightened).toBe(1)
  })

  test("leaves a 45 degree chamfer drawn by hand alone", () => {
    const chamfer = [pt(0, 0), pt(10, 0), pt(11, 1), pt(11, 10)]
    expect(straightenTrack(chamfer).straightened).toBe(0)
  })

  test("leaves square the corners a fillet could not round", () => {
    const track = [pt(0, 0), pt(10, 0), pt(10, 0.5), pt(20, 0.5), pt(20, 10)]
    const rounded = filletTrack(track, 1, 0.25)
    expect(rounded.rounded).toBe(1)
    expect(near(straightenTrack(rounded.points).points, track)).toBe(true)
  })
})
