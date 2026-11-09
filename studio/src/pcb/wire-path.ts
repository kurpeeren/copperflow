// The path of a schematic wire: each leg squared to horizontal and vertical runs, and tidied for saving.
import type { Point } from "./geometry.js"

/** Positions are rounded to 4 decimals, as the rest of Studio rounds what it writes. */
const round = (value: number): number => Math.round(value * 10000) / 10000 || 0

/** `bends[i]` is true when leg i (from point i to point i + 1) runs vertically first; missing means horizontally first. */
export type Bends = readonly boolean[]

const same = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

/** The points of one leg, including the elbow when the ends are off both axes. */
function squareLeg(from: Point, to: Point, verticalFirst: boolean): Point[] {
  if (from.x === to.x || from.y === to.y) return [to]
  return [verticalFirst ? { x: from.x, y: to.y } : { x: to.x, y: from.y }, to]
}

/** The wire through the points with every leg turned at one right angle, each leg with its own bend. */
export function squarePath(points: readonly Point[], bends: Bends = []): Point[] {
  const first = points[0]
  if (!first) return []
  const path: Point[] = [first]
  for (let i = 1; i < points.length; i++) {
    path.push(...squareLeg(points[i - 1] as Point, points[i] as Point, bends[i - 1] === true))
  }
  return path
}

/** The path with positions rounded, repeated points dropped, and points in the middle of a straight horizontal or vertical run dropped; both ends stay. */
export function tidyPath(points: readonly Point[]): Point[] {
  const rounded = points.map((p) => ({ x: round(p.x), y: round(p.y) }))
  const path: Point[] = []
  for (const p of rounded) {
    const last = path[path.length - 1]
    if (!last || !same(last, p)) path.push(p)
  }
  return path.filter((p, i) => {
    const [before, after] = [path[i - 1], path[i + 1]]
    if (!before || !after) return true
    return !((before.x === p.x && p.x === after.x) || (before.y === p.y && p.y === after.y))
  })
}

/** The wire as drawn and saved: squared per leg, then tidied. */
export function wirePath(points: readonly Point[], bends: Bends = []): Point[] {
  return tidyPath(squarePath(points, bends))
}
