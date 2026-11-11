import type { Box } from "../checks/grid-index.js"
import { pointInPolygon } from "../checks/geometry.js"
import type { Point } from "../model.js"

export type { Box }

/** Placement walks a grid of this pitch (mm), the same as the build's packing. */
export const GRID = 0.5
/** Two lengths closer than this are equal. */
export const EPSILON = 1e-6
/** The four rotations the placer tries, in degrees counter-clockwise; a part's rotation is an index into it. */
export const ROTATIONS = [0, 90, 180, 270] as const

/** A point turned by `quarter` quarter turns counter-clockwise, exactly. */
export function turn(p: Point, quarter: number): Point {
  switch (quarter & 3) {
    case 1:
      return { x: -p.y, y: p.x }
    case 2:
      return { x: -p.x, y: -p.y }
    case 3:
      return { x: p.y, y: -p.x }
    default:
      return { x: p.x, y: p.y }
  }
}

export function boxOfPoints(points: readonly Point[]): Box {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

export const moved = (b: Box, x: number, y: number): Box => ({ minX: b.minX + x, minY: b.minY + y, maxX: b.maxX + x, maxY: b.maxY + y })

/** Whether two boxes come closer than `gap`; boxes exactly `gap` apart do not. */
export function tooClose(a: Box, b: Box, gap: number): boolean {
  const g = gap - EPSILON
  return a.minX < b.maxX + g && b.minX < a.maxX + g && a.minY < b.maxY + g && b.minY < a.maxY + g
}

export const snap = (value: number): number => Math.round(value / GRID) * GRID

/**
 * Where courtyards may go: inside `box` (the outline's bounds less the edge clearance) and, for an outline that is
 * not a rectangle, with the box grown by the edge clearance inside `polygon`.
 */
export interface Area {
  box: Box
  polygon?: readonly Point[]
  edge: number
}

export function inArea(b: Box, area: Area): boolean {
  const a = area.box
  if (b.minX < a.minX - EPSILON || b.maxX > a.maxX + EPSILON || b.minY < a.minY - EPSILON || b.maxY > a.maxY + EPSILON) return false
  if (!area.polygon) return true
  const grown = { minX: b.minX - area.edge, minY: b.minY - area.edge, maxX: b.maxX + area.edge, maxY: b.maxY + area.edge }
  const corners = [
    { x: grown.minX, y: grown.minY },
    { x: grown.maxX, y: grown.minY },
    { x: grown.maxX, y: grown.maxY },
    { x: grown.minX, y: grown.maxY },
  ]
  if (!corners.every((c) => pointInPolygon(c, area.polygon as Point[]))) return false
  // A notch of the outline reaching into the box has an edge passing through it, even with every corner outside.
  const outline = area.polygon
  return !outline.some((p, k) => segmentEntersBox(p, outline[(k + 1) % outline.length] as Point, grown))
}

/** Whether the segment from `p` to `q` passes through the inside of the box (touching its sides does not count). */
export function segmentEntersBox(p: Point, q: Point, b: Box): boolean {
  // Liang-Barsky: clip the segment's parameter range to each slab of the box shrunk by EPSILON.
  let [t0, t1] = [0, 1]
  const [dx, dy] = [q.x - p.x, q.y - p.y]
  const slabs: [number, number, number, number][] = [
    [dx, p.x, b.minX + EPSILON, b.maxX - EPSILON],
    [dy, p.y, b.minY + EPSILON, b.maxY - EPSILON],
  ]
  for (const [d, start, low, high] of slabs) {
    if (Math.abs(d) < 1e-12) {
      if (start <= low || start >= high) return false
      continue
    }
    const [a, c] = [(low - start) / d, (high - start) / d]
    t0 = Math.max(t0, Math.min(a, c))
    t1 = Math.min(t1, Math.max(a, c))
    if (t0 >= t1) return false
  }
  return true
}

/** Whether the outline is an axis-aligned rectangle (four corners, each side along x or y). */
export function isRectangle(outline: readonly Point[]): boolean {
  if (outline.length !== 4) return false
  const b = boxOfPoints(outline)
  const onCorner = (p: Point) => (Math.abs(p.x - b.minX) < EPSILON || Math.abs(p.x - b.maxX) < EPSILON) && (Math.abs(p.y - b.minY) < EPSILON || Math.abs(p.y - b.maxY) < EPSILON)
  const distinct = new Set(outline.map((p) => `${Math.round(p.x / EPSILON)},${Math.round(p.y / EPSILON)}`))
  return outline.every(onCorner) && distinct.size === 4
}

const CELL = 2

/** Boxes by id in a uniform grid of CELL mm, with removal, for the overlap tests. */
export class BoxIndex {
  private readonly cells = new Map<number, Set<number>>()
  private readonly boxes = new Map<number, Box>()

  get(id: number): Box | undefined {
    return this.boxes.get(id)
  }

  set(id: number, box: Box): void {
    this.remove(id)
    this.boxes.set(id, box)
    this.visit(box, 0, (key) => {
      const cell = this.cells.get(key)
      if (cell) cell.add(id)
      else this.cells.set(key, new Set([id]))
    })
  }

  remove(id: number): void {
    const box = this.boxes.get(id)
    if (!box) return
    this.boxes.delete(id)
    this.visit(box, 0, (key) => this.cells.get(key)?.delete(id))
  }

  /** The ids of the boxes in the cells `box` touches, ascending; some may lie outside `box` itself. */
  near(box: Box): number[] {
    const found = new Set<number>()
    this.visit(box, 0, (key) => this.cells.get(key)?.forEach((id) => found.add(id)))
    return [...found].sort((a, b) => a - b)
  }

  /** Whether a point lies strictly inside one of the boxes. */
  covers(x: number, y: number): boolean {
    const key = Math.floor(x / CELL) * 100_003 + Math.floor(y / CELL)
    for (const id of this.cells.get(key) ?? []) {
      const b = this.boxes.get(id) as Box
      if (x > b.minX + EPSILON && x < b.maxX - EPSILON && y > b.minY + EPSILON && y < b.maxY - EPSILON) return true
    }
    return false
  }

  /** Whether any box but those `ignore` names comes closer than `gap` to `box`. */
  clashes(box: Box, gap: number, ignore?: (id: number) => boolean): boolean {
    let hit = false
    this.visit(box, gap, (key) => {
      if (hit) return
      for (const id of this.cells.get(key) ?? []) {
        if (ignore?.(id)) continue
        if (tooClose(box, this.boxes.get(id) as Box, gap)) {
          hit = true
          return
        }
      }
    })
    return hit
  }

  private visit(box: Box, grow: number, each: (key: number) => void): void {
    const x0 = Math.floor((box.minX - grow) / CELL)
    const x1 = Math.floor((box.maxX + grow) / CELL)
    const y0 = Math.floor((box.minY - grow) / CELL)
    const y1 = Math.floor((box.maxY + grow) / CELL)
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) each(cx * 100_003 + cy)
  }
}
