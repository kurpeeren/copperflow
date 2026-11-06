import type { Point } from "./model.js"

export interface Bounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Auto-placement walks a grid of this pitch (mm). */
export const GRID = 0.5
/** The scan never goes further than this from the centre (mm). */
export const MAX_REACH = 200
const TOUCH_TOLERANCE = 1e-9

export function boundsOf(points: readonly Point[]): Bounds {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

const shifted = (b: Bounds, dx: number, dy: number): Bounds => ({ minX: b.minX + dx, maxX: b.maxX + dx, minY: b.minY + dy, maxY: b.maxY + dy })

/** Touching edges do not overlap. */
function overlaps(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX - TOUCH_TOLERANCE && b.minX < a.maxX - TOUCH_TOLERANCE && a.minY < b.maxY - TOUCH_TOLERANCE && b.minY < a.maxY - TOUCH_TOLERANCE
}

const inside = (inner: Bounds, outer: Bounds): boolean =>
  inner.minX >= outer.minX - TOUCH_TOLERANCE &&
  inner.maxX <= outer.maxX + TOUCH_TOLERANCE &&
  inner.minY >= outer.minY - TOUCH_TOLERANCE &&
  inner.maxY <= outer.maxY + TOUCH_TOLERANCE

/** Grid cells at Chebyshev distance `ring` from the centre cell, in a fixed order. */
function* ringCells(ring: number): Generator<[number, number]> {
  if (ring === 0) {
    yield [0, 0]
    return
  }
  for (let i = -ring; i <= ring; i++) {
    yield [i, -ring]
    yield [i, ring]
  }
  for (let j = -ring + 1; j < ring; j++) {
    yield [-ring, j]
    yield [ring, j]
  }
}

interface Scan {
  centre: Point
  /** Courtyard bounds relative to the part origin. */
  relative: Bounds
  occupied: readonly Bounds[]
  /** When set, the courtyard must lie inside these bounds. */
  within: Bounds | undefined
  rings: number
}

/** Returns the first free spot, or the last position tried when there is none. */
function scan(s: Scan): { spot: Point; found: boolean } {
  let last: Point = s.centre
  for (let ring = 0; ring <= s.rings; ring++) {
    for (const [i, j] of ringCells(ring)) {
      last = { x: s.centre.x + i * GRID, y: s.centre.y + j * GRID }
      const box = shifted(s.relative, last.x, last.y)
      if (s.within && !inside(box, s.within)) continue
      if (!s.occupied.some((other) => overlaps(box, other))) return { spot: last, found: true }
    }
  }
  return { spot: last, found: false }
}

/**
 * Where to put a part with the given courtyard bounds: the first free grid spot in rings around
 * the board centre that lies inside the board; else the first free spot outside it, out to
 * MAX_REACH; else the last position tried.
 */
export function findSpot(relative: Bounds, occupied: readonly Bounds[], board: Bounds | undefined): Point {
  const centre = board ? { x: (board.minX + board.maxX) / 2, y: (board.minY + board.maxY) / 2 } : { x: 0, y: 0 }
  const maxRings = Math.ceil(MAX_REACH / GRID)
  if (board) {
    const reach = Math.max(board.maxX - board.minX, board.maxY - board.minY) / 2
    const inBoard = scan({ centre, relative, occupied, within: board, rings: Math.min(maxRings, Math.ceil(reach / GRID)) })
    if (inBoard.found) return inBoard.spot
  }
  return scan({ centre, relative, occupied, within: undefined, rings: maxRings }).spot
}
