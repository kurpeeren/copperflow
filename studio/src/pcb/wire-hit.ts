// Where the pointer is on a schematic wire: the wire and the segment under it, and the handles a selected wire shows
// (squares on its corners, its two ends apart since they stay on their pins). The canvas, the hover and the H key share
// this one rule. Plain TypeScript with .js imports, so the tests can run it.
import type { Point } from "./geometry.js"
import { wireStrokePx } from "./schematic-draw.js"

/** How close to a wire's segment the pointer must be to pick the wire, in CSS pixels, while the wire is drawn thinner. */
export const WIRE_REACH_PX = 6
/** How far past the drawn stroke's edge the pointer still reaches the wire. */
const PAST_STROKE_PX = 2

/** `least` CSS pixels from a wire's centre line, or 2 past its drawn stroke's edge where the stroke is wider (deep zoom). */
export function pastStrokePx(least: number, scale: number): number {
  return Math.max(least, wireStrokePx(scale) / 2 + PAST_STROKE_PX)
}

/** The reach at this zoom, in CSS pixels: 6, or half the drawn stroke and 2 when the stroke is wider. */
export const wireReachPx = (scale: number): number => pastStrokePx(WIRE_REACH_PX, scale)

/** A wire as the hit test sees it: its id and its points, first to last. */
export interface WireLine {
  id: string
  points: readonly Point[]
}

/** The distance from `p` to the segment from `a` to `b`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** The nearest segment of `points` to `p`, as its index and distance. */
function nearestSegment(points: readonly Point[], p: Point): { index: number; distance: number } | undefined {
  let best: { index: number; distance: number } | undefined
  for (let i = 1; i < points.length; i++) {
    const distance = distanceToSegment(p, points[i - 1] as Point, points[i] as Point)
    if (!best || distance < best.distance) best = { index: i - 1, distance }
  }
  return best
}

/** The index of the segment (from point i to point i+1) nearest to `p` within `reach`, in sheet units. */
export function segmentAt(points: readonly Point[], p: Point, reach: number): number | undefined {
  const nearest = nearestSegment(points, p)
  return nearest && nearest.distance <= reach ? nearest.index : undefined
}

/** The id of the wire nearest to `p` within `reach`, in sheet units (wireReachPx over the camera's scale). */
export function wireAt(wires: readonly WireLine[], p: Point, reach: number): string | undefined {
  let best: { id: string; distance: number } | undefined
  for (const wire of wires) {
    const nearest = nearestSegment(wire.points, p)
    if (nearest && nearest.distance <= reach && (!best || nearest.distance < best.distance)) best = { id: wire.id, distance: nearest.distance }
  }
  return best?.id
}

/** A selected wire's handles: a square on each corner, and its two ends, which are drawn hollow and do not move. */
export function wireHandles(points: readonly Point[]): { corners: Point[]; ends: Point[] } {
  if (points.length < 2) return { corners: [], ends: [...points] }
  return { corners: points.slice(1, -1), ends: [points[0] as Point, points[points.length - 1] as Point] }
}

/** The index (in `points`) of the corner whose square handle, `reach` from its centre each way, holds `p`; never an end. */
export function cornerAt(points: readonly Point[], p: Point, reach: number): number | undefined {
  const index = points.findIndex((corner, i) => i > 0 && i < points.length - 1 && Math.abs(corner.x - p.x) <= reach && Math.abs(corner.y - p.y) <= reach)
  return index < 0 ? undefined : index
}
