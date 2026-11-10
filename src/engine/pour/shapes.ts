import type { Shape } from "../checks/geometry.js"
import type { Point } from "../model.js"

/** How far a straight side may stand off the true arc it replaces, in mm. */
const ARC_TOLERANCE = 0.002
/** A full circle has at least this many sides, however small. */
const MIN_SIDES = 8
const FULL_TURN = 2 * Math.PI

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/** The convex hull, counter-clockwise, without repeated or in-line points: one point, two, or a polygon. */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const unique = sorted.filter((p, i) => i === 0 || p.x !== sorted[i - 1]?.x || p.y !== sorted[i - 1]?.y)
  if (unique.length < 3) return unique
  const half = (list: readonly Point[]) => {
    const chain: Point[] = []
    for (const p of list) {
      while (chain.length >= 2 && cross(chain[chain.length - 2] as Point, chain[chain.length - 1] as Point, p) <= 0) chain.pop()
      chain.push(p)
    }
    return chain.slice(0, -1)
  }
  const hull = [...half(unique), ...half([...unique].reverse())]
  return hull.length >= 2 ? hull : unique.slice(0, 1)
}

/** The outward normal of the side from a to b of a counter-clockwise polygon: its right-hand side. */
function normal(a: Point, b: Point): number {
  return Math.atan2(-(b.x - a.x), b.y - a.y)
}

/**
 * The points of an arc of `radius` round `centre` from angle `from` turning `sweep` counter-clockwise: its two ends on
 * the circle and, between them, the corners of sides that touch the circle, so the polygon never cuts inside the arc.
 */
function arc(centre: Point, radius: number, from: number, sweep: number, closed: boolean): Point[] {
  const maxHalf = Math.min(Math.acos(radius / (radius + ARC_TOLERANCE)), Math.PI / MIN_SIDES)
  const sides = Math.max(1, Math.ceil(sweep / (2 * maxHalf)))
  const half = sweep / (2 * sides)
  const reach = radius / Math.cos(half)
  const at = (angle: number, r: number) => ({ x: centre.x + r * Math.cos(angle), y: centre.y + r * Math.sin(angle) })
  const corners = Array.from({ length: sides }, (_, i) => at(from + (2 * i + 1) * half, reach))
  return closed ? corners : [at(from, radius), ...corners, at(from + sweep, radius)]
}

/**
 * A shape (a convex core grown by its radius) grown by `grow` more, as a counter-clockwise polygon in mm that holds
 * the true shape: round parts are drawn with sides that touch them from outside. An empty list for a shape with no area.
 */
export function shapeOutline(shape: Shape, grow = 0): Point[] {
  const radius = shape.radius + grow
  const core = convexHull(shape.core)
  if (radius <= 0) return core.length >= 3 ? core : []
  if (core.length === 1) return arc(core[0] as Point, radius, 0, FULL_TURN, true)
  return core.flatMap((corner, i) => {
    const before = core[(i - 1 + core.length) % core.length] as Point
    const after = core[(i + 1) % core.length] as Point
    const from = normal(before, corner)
    const to = normal(corner, after)
    const sweep = (((to - from) % FULL_TURN) + FULL_TURN) % FULL_TURN || FULL_TURN
    return arc(corner, radius, from, sweep, false)
  })
}
