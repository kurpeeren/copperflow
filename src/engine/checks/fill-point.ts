// Where a finding about a whole pour points: a spot well inside its copper, so that the place a person or an agent is
// sent to is on the board and on the pour, not on a corner of its outline (a fill's first vertex sits on its rounded
// edge, a hair inside the board-edge clearance, where nothing can be seen of the pour).
import type { Point } from "../model.js"
import type { PourFill, PourPolygon } from "../pour/fill.js"
import { pointInPolygon } from "./geometry.js"

/** The grid of candidate spots laid over a fill's largest piece, per side. */
const STEPS = 24

/** The distance from `p` to the nearest edge of a ring. */
function ringDistance(p: Point, ring: readonly Point[]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i] as Point
    const b = ring[(i + 1) % ring.length] as Point
    const [dx, dy] = [b.x - a.x, b.y - a.y]
    const length = dx * dx + dy * dy
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)))
  }
  return best
}

/** Twice the signed area of a ring; its size is what matters here. */
function ringArea(ring: readonly Point[]): number {
  let sum = 0
  for (let i = 0; i < ring.length; i++) {
    const [a, b] = [ring[i] as Point, ring[(i + 1) % ring.length] as Point]
    sum += a.x * b.y - b.x * a.y
  }
  return Math.abs(sum)
}

const inCopper = (p: Point, piece: PourPolygon): boolean => pointInPolygon(p, piece.outer) && !piece.holes.some((hole) => pointInPolygon(p, hole))

/** How deep inside the piece a spot is: its distance to the nearest edge or hole. */
const depth = (p: Point, piece: PourPolygon): number => piece.holes.reduce((d, hole) => Math.min(d, ringDistance(p, hole)), ringDistance(p, piece.outer))

/**
 * A spot inside the fill's largest piece (in its copper, out of its holes), the deepest of a grid laid over it, rounded
 * to the micrometre; undefined for a fill with no copper.
 */
export function fillPoint(fill: Pick<PourFill, "polygons">): Point | undefined {
  const piece = [...fill.polygons].sort((a, b) => ringArea(b.outer) - ringArea(a.outer))[0]
  if (piece === undefined || piece.outer.length === 0) return undefined
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of piece.outer) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  let best: { at: Point; depth: number } | undefined
  for (let i = 1; i < STEPS; i++) {
    for (let j = 1; j < STEPS; j++) {
      const at = { x: minX + ((maxX - minX) * i) / STEPS, y: minY + ((maxY - minY) * j) / STEPS }
      if (!inCopper(at, piece)) continue
      const d = depth(at, piece)
      if (best === undefined || d > best.depth) best = { at, depth: d }
    }
  }
  const at = best?.at ?? piece.outer[0]
  return at === undefined ? undefined : { x: Math.round(at.x * 1e6) / 1e6, y: Math.round(at.y * 1e6) / 1e6 }
}
