// Reshaping a PCB track by dragging one of its segments or corners. A square track (every segment horizontal or
// vertical) moves exactly as a schematic wire does (wire-drag.ts draggedPath, wire-geometry.ts dragSegment and
// dragCorner). Where a slanted (45°) segment is involved, the dragged segment moves along its normal and each
// neighbour stretches along its own direction to meet it, as EasyEDA's track drag does; a corner beside a slanted
// segment goes where the pointer puts it. The first and last points are the track's ends and stay (on their pads): an
// end beside the dragged segment gains a new segment there. Pure; plain TypeScript with .js imports for the tests.
import { roundPosition, snapPosition, type Point } from "./geometry.js"
import { draggedPath, type DragGrid } from "./wire-drag.js"
import { directionOf } from "./wire-geometry.js"
import type { CopperGrip } from "./copper-hit.js"

/** Closer than this, two numbers are the same; points are rounded to 4 decimals. */
const EPSILON = 1e-9

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const scaled = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k })
const cross = (a: Point, b: Point): number => a.x * b.y - a.y * b.x
const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

/** Whether every segment of the path is horizontal or vertical. */
function square(points: readonly Point[]): boolean {
  return points.every((p, i) => i === 0 || directionOf(points[i - 1] as Point, p) !== "slanted")
}

/** The path rounded to 4 decimals, without repeated points or points in the middle of a straight run; both ends stay. */
export function tidyTrack(points: readonly Point[]): Point[] {
  const rounded = points.map((p) => ({ x: roundPosition(p.x), y: roundPosition(p.y) }))
  const path = rounded.filter((p, i) => i === 0 || !samePoint(rounded[i - 1] as Point, p))
  const kept: Point[] = []
  for (const [i, p] of path.entries()) {
    const [before, after] = [kept[kept.length - 1], path[i + 1]]
    if (before && after && Math.abs(cross(sub(p, before), sub(after, p))) < EPSILON) continue
    kept.push(p)
  }
  return kept
}

/** Where the line through `p` along `along` meets the line through `q` along `dir`; undefined when they run parallel. */
function meet(p: Point, along: Point, q: Point, dir: Point): Point | undefined {
  const det = cross(along, dir)
  if (Math.abs(det) < EPSILON) return undefined
  return add(p, scaled(along, cross(sub(q, p), dir) / det))
}

/** Segment `index` moved by `offset` across itself; each end meets its neighbour's line, or keeps its point when it is the track's end. */
function shiftAcross(points: readonly Point[], index: number, offset: Point): Point[] {
  const [a, b] = [points[index] as Point, points[index + 1] as Point]
  const along = sub(b, a)
  const start = add(a, offset)
  const endAt = (k: number, neighbour: number): Point[] => {
    const own = points[k] as Point
    const other = points[neighbour]
    const met = other && meet(other, sub(own, other), start, along)
    return met ? [met] : k === index ? [own, add(own, offset)] : [add(own, offset), own]
  }
  const head = index === 0 ? [a, start] : endAt(index, index - 1)
  const tail = index + 1 === points.length - 1 ? [add(b, offset), b] : endAt(index + 1, index + 2)
  return [...points.slice(0, index), ...head, ...tail, ...points.slice(index + 2)]
}

/** The pointer's move as an offset along the normal of the segment from `a` to `b`, from the grabbed point snapped as Snap says. */
function normalOffset(a: Point, b: Point, moved: Point, grid: DragGrid): Point {
  const target = { x: snapPosition(a.x + moved.x, grid.step, grid.snap), y: snapPosition(a.y + moved.y, grid.step, grid.snap) }
  const along = sub(b, a)
  const length = Math.hypot(along.x, along.y)
  if (length < EPSILON) return { x: 0, y: 0 }
  const normal = { x: -along.y / length, y: along.x / length }
  const distance = (target.x - a.x) * normal.x + (target.y - a.y) * normal.y
  return scaled(normal, distance)
}

/** The path when corner `index` goes where the pointer puts it, snapped as Snap says. */
function movedCorner(points: readonly Point[], index: number, moved: Point, grid: DragGrid): Point[] {
  const at = points[index] as Point
  const to = { x: snapPosition(at.x + moved.x, grid.step, grid.snap), y: snapPosition(at.y + moved.y, grid.step, grid.snap) }
  return points.map((p, k) => (k === index ? to : p))
}

/**
 * The track's path after the pointer moved by `moved` (mm) from a press that grabbed `grip`, worked out from the
 * points at the press. A path that would fold to a single point is returned unchanged.
 */
export function trackDragPath(points: readonly Point[], grip: CopperGrip, moved: Point, grid: DragGrid): Point[] {
  const a = points[grip.index]
  const b = points[grip.index + 1]
  if (!a || (grip.kind === "segment" && !b)) return [...points]
  let path: Point[]
  if (square(points)) path = draggedPath(points, grip, moved, grid)
  else if (grip.kind === "corner") path = movedCorner(points, grip.index, moved, grid)
  else path = shiftAcross(points, grip.index, normalOffset(a, b as Point, moved, grid))
  const tidied = tidyTrack(path)
  return tidied.length >= 2 ? tidied : [...points]
}
