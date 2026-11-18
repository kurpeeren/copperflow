// Closed rings of one filled shape sorted into outer rings and holes by the fill rule. Each ring is a boundary
// between two winding numbers: the one just outside it (the sum over the rings that contain it) and that plus its own
// direction. Under the rule, a ring with ink inside and none outside is an outer ring, one with ink outside and none
// inside is a hole, and one with ink (or none) on both sides draws nothing. Rings that cross each other are outside
// what this does: their nesting is taken from one point of each, which gives some answer and never fails.
import type { Point } from "../model.js"
import { cleanRing, GraphicError, signedArea, wound, type GraphicFill } from "./shapes.js"

export type FillRule = "nonzero" | "evenodd"

/** The most rings one filled shape may have: nesting compares every pair. */
export const MAX_RINGS_PER_SHAPE = 5000

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

interface Ring {
  points: Point[]
  box: Box
  area: number
}

function boxOf(points: readonly Point[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (const p of points) {
    box.minX = Math.min(box.minX, p.x)
    box.minY = Math.min(box.minY, p.y)
    box.maxX = Math.max(box.maxX, p.x)
    box.maxY = Math.max(box.maxY, p.y)
  }
  return box
}

/** The winding number of `ring` around `p` (crossing count signed by direction). */
function windingAround(ring: Ring, p: Point): number {
  if (p.x < ring.box.minX || p.x > ring.box.maxX || p.y < ring.box.minY || p.y > ring.box.maxY) return 0
  let winding = 0
  const pts = ring.points
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i] as Point
    const b = pts[(i + 1) % pts.length] as Point
    const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y)
    if (a.y <= p.y && b.y > p.y && side > 0) winding++
    else if (a.y > p.y && b.y <= p.y && side < 0) winding--
  }
  return winding
}

const inked = (winding: number, rule: FillRule) => (rule === "nonzero" ? winding !== 0 : winding % 2 !== 0)

/** A point for testing which rings contain this one: the middle of its first edge, nudged off its corners. */
const probeOf = (ring: Ring): Point => {
  const [a, b] = ring.points as [Point, Point]
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function classify(rings: readonly Ring[], rule: FillRule): ("outer" | "hole" | "none")[] {
  return rings.map((ring, i) => {
    const probe = probeOf(ring)
    let outside = 0
    let containers = 0
    rings.forEach((other, j) => {
      if (j === i) return
      const w = windingAround(other, probe)
      outside += w
      if (w !== 0) containers++
    })
    const own = ring.area > 0 ? 1 : -1
    const inside = rule === "nonzero" ? outside + own : containers + 1
    const out = rule === "nonzero" ? outside : containers
    if (inked(inside, rule) && !inked(out, rule)) return "outer"
    if (!inked(inside, rule) && inked(out, rule)) return "hole"
    return "none"
  })
}

/** The smallest outer ring that contains the hole, by index. */
function ownerOf(hole: Ring, outers: readonly Ring[]): number {
  const probe = probeOf(hole)
  let best = -1
  outers.forEach((outer, k) => {
    if (Math.abs(outer.area) <= Math.abs(hole.area) || windingAround(outer, probe) === 0) return
    if (best === -1 || Math.abs(outer.area) < Math.abs((outers[best] as Ring).area)) best = k
  })
  return best
}

/** Filled shapes from the rings of one path under its fill rule: outer rings counter-clockwise, holes clockwise. */
export function fillsFromRings(raw: readonly (readonly Point[])[], rule: FillRule): GraphicFill[] {
  const rings: Ring[] = raw
    .map((points) => cleanRing(points))
    .filter((points) => points.length >= 3)
    .map((points) => ({ points, box: boxOf(points), area: signedArea(points) }))
    .filter((ring) => ring.area !== 0)
  if (rings.length > MAX_RINGS_PER_SHAPE) throw new GraphicError(`A filled shape has more than ${MAX_RINGS_PER_SHAPE} rings; simplify it first`)
  const kinds = classify(rings, rule)
  const outers = rings.filter((_, i) => kinds[i] === "outer")
  const holes: Point[][][] = outers.map(() => [])
  rings.forEach((ring, i) => {
    if (kinds[i] !== "hole") return
    const owner = ownerOf(ring, outers)
    if (owner !== -1) (holes[owner] as Point[][]).push(wound(ring.points, false))
  })
  return outers.map((outer, k) => ({ outer: wound(outer.points, true), holes: holes[k] as Point[][] }))
}
