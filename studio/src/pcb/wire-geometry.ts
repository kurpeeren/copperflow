// Reshaping a schematic wire: dragging one of its segments or corners, and removing a corner. Pure
// geometry on a list of points. The first and last points are the wire's ends and never move: a
// segment that touches an end (or whose neighbour would turn slanted) gets a new segment there.
import type { Point } from "./geometry.js"
import { squarePath, tidyPath, type Bends } from "./wire-path.js"

/** Positions closer than this are the same; paths are rounded to 4 decimals. */
const EPSILON = 1e-9
const ZERO: Point = { x: 0, y: 0 }
const nearly = (a: number, b: number): boolean => Math.abs(a - b) < EPSILON

export type Direction = "horizontal" | "vertical" | "slanted"

/** Which way the segment from `a` to `b` runs; two points at the same spot count as horizontal. */
export function directionOf(a: Point, b: Point): Direction {
  if (nearly(a.y, b.y)) return "horizontal"
  return nearly(a.x, b.x) ? "vertical" : "slanted"
}

/** How a segment of direction `direction` moves for a pointer delta: along its normal only, or all of it when slanted. */
function allowedShift(direction: Direction, delta: Point): Point {
  if (direction === "horizontal") return { x: 0, y: delta.y }
  return direction === "vertical" ? { x: delta.x, y: 0 } : delta
}

/** Whether a segment keeps its direction when one of its ends moves by `shift`. */
function staysStraight(direction: Direction, shift: Point): boolean {
  if (direction === "horizontal") return nearly(shift.y, 0)
  return direction === "vertical" ? nearly(shift.x, 0) : true
}

/** The shift of each point of the path: what the dragged segments move it by. */
function pointShifts(path: readonly Point[], shifts: ReadonlyMap<number, Point>): Point[] {
  return path.map((_, k) => {
    const touching = [shifts.get(k - 1), shifts.get(k)].filter((s): s is Point => s !== undefined)
    return { x: touching.find((s) => !nearly(s.x, 0))?.x ?? 0, y: touching.find((s) => !nearly(s.y, 0))?.y ?? 0 }
  })
}

/** Whether the point at `k` must stay and gain a new segment: it is an end of the wire, or the segment beside it would turn slanted. */
function mustStay(path: readonly Point[], k: number, shift: Point, dragged: ReadonlyMap<number, Point>): boolean {
  if (k === 0 || k === path.length - 1) return true
  const beside = dragged.has(k) ? k - 1 : k
  const [a, b] = [path[beside], path[beside + 1]]
  return a !== undefined && b !== undefined && !staysStraight(directionOf(a, b), shift)
}

/** The path with each segment in `dragged` moved by its shift; neighbours stretch, and an end or a turned segment keeps its old point. */
function shiftSegments(path: readonly Point[], dragged: ReadonlyMap<number, Point>): Point[] {
  const shifts = pointShifts(path, dragged)
  return tidyPath(
    path.flatMap((p, k) => {
      const shift = shifts[k] ?? ZERO
      const moved = { x: p.x + shift.x, y: p.y + shift.y }
      const before = dragged.has(k - 1)
      if (before === dragged.has(k) || !mustStay(path, k, shift, dragged)) return [moved]
      return before ? [moved, p] : [p, moved]
    }),
  )
}

/**
 * Drags segment `index` (from point `index` to the next) by `delta` from the path as it was when
 * the drag began. A horizontal segment moves up or down, a vertical one left or right, a slanted one
 * (old files) by the whole delta. Returns the tidied path.
 */
export function dragSegment(path: readonly Point[], index: number, delta: Point): Point[] {
  const [a, b] = [path[index], path[index + 1]]
  if (!a || !b) return tidyPath(path)
  return shiftSegments(path, new Map([[index, allowedShift(directionOf(a, b), delta)]]))
}

/**
 * Moves corner `index` (an interior point) to `to`; its two segments keep their direction, as the
 * two segment drags together would. The ends of the wire cannot be dragged.
 */
export function dragCorner(path: readonly Point[], index: number, to: Point): Point[] {
  const [before, corner, after] = [path[index - 1], path[index], path[index + 1]]
  if (!before || !corner || !after) return tidyPath(path)
  const delta = { x: to.x - corner.x, y: to.y - corner.y }
  return shiftSegments(
    path,
    new Map([
      [index - 1, allowedShift(directionOf(before, corner), delta)],
      [index, allowedShift(directionOf(corner, after), delta)],
    ]),
  )
}

/**
 * Drops corner `index` and squares the path again. The new leg bends the other way from the
 * removed corner, so a corner of a Z-shaped wire goes away instead of coming back.
 */
export function removeCorner(path: readonly Point[], index: number): Point[] {
  const [before, corner] = [path[index - 1], path[index]]
  if (!before || !corner || index >= path.length - 1) return tidyPath(path)
  const bends: boolean[] = path.slice(0, -2).map(() => false)
  bends[index - 1] = directionOf(before, corner) === "horizontal"
  return tidyPath(squarePath(path.filter((_, k) => k !== index), bends as Bends))
}

/** Drops repeated points and points in the middle of a straight run, rounds to 4 decimals. */
export const tidy = tidyPath
