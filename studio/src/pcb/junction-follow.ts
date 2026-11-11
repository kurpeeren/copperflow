// A junction belongs to the wire it sits on: when that wire takes a new shape the junction moves with it, keeping its
// place along the same segment, and when the wire goes the junction goes too. A junction where another wire still
// passes stays, since it still joins that one. The edits ride in the wire's own change, so one history entry. Pure.
import type { Edit } from "../../../src/core/types.js"
import type { Point } from "./geometry.js"

/** How near a junction must be to a wire to sit on it, in mm: the positions are written rounded. */
const ON_WIRE = 1e-3

export interface SheetJunction {
  id: string
  x: number
  y: number
}

/** The junctions among the sheet's drawings. */
export const junctionsIn = (drawings: readonly { id: string; kind: string; x?: number; y?: number }[]): SheetJunction[] =>
  drawings.flatMap((drawing) => (drawing.kind === "junction" && drawing.x !== undefined && drawing.y !== undefined ? [{ id: drawing.id, x: drawing.x, y: drawing.y }] : []))

/** Where `p` lies on the path: the segment and how far along it (0 to 1), when it is within ON_WIRE of it. */
function along(p: Point, points: readonly Point[]): { segment: number; t: number } | undefined {
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1] as Point, points[i] as Point]
    const [dx, dy] = [b.x - a.x, b.y - a.y]
    const length = dx * dx + dy * dy
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    if (Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <= ON_WIRE) return { segment: i - 1, t }
  }
  return undefined
}

const onAny = (p: Point, wires: readonly (readonly Point[])[]) => wires.some((points) => along(p, points) !== undefined)

/** The point of the path nearest `p`. */
function nearest(p: Point, points: readonly Point[]): Point {
  let best = points[0] as Point
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1] as Point, points[i] as Point]
    const [dx, dy] = [b.x - a.x, b.y - a.y]
    const length = dx * dx + dy * dy
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    const q = { x: a.x + t * dx, y: a.y + t * dy }
    if (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(best.x - p.x, best.y - p.y)) best = q
  }
  return best
}

const round = (v: number) => Math.round(v * 1000) / 1000

/**
 * The edits that move the junctions on a wire's old path to its new one: the same place along the same segment when
 * the path keeps its number of corners (a segment dragged), else the point of the new path nearest it. A junction
 * another wire (`others`) also passes through stays where it is.
 */
export function junctionMoves(junctions: readonly SheetJunction[], before: readonly Point[], after: readonly Point[], others: readonly (readonly Point[])[]): Edit[] {
  if (after.length < 2) return []
  return junctions.flatMap((junction): Edit[] => {
    const at = along(junction, before)
    if (at === undefined || onAny(junction, others)) return []
    const sameShape = after.length === before.length
    const [a, b] = [after[at.segment] as Point, after[at.segment + 1] as Point]
    const moved = sameShape ? { x: a.x + at.t * (b.x - a.x), y: a.y + at.t * (b.y - a.y) } : nearest(junction, after)
    const to = { x: round(moved.x), y: round(moved.y) }
    if (Math.abs(to.x - junction.x) < ON_WIRE && Math.abs(to.y - junction.y) < ON_WIRE) return []
    return [{ kind: "setDrawingProps", id: junction.id, props: to }]
  })
}

/** The junctions that go with the wires removed (`gone`): those on one of them and on no wire that stays (`kept`). */
export function junctionsGone(junctions: readonly SheetJunction[], gone: readonly (readonly Point[])[], kept: readonly (readonly Point[])[]): string[] {
  return junctions.filter((junction) => onAny(junction, gone) && !onAny(junction, kept)).map((junction) => junction.id)
}
