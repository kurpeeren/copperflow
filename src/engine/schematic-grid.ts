// The 0.1 sheet grid the schematic router searches on: cells are integer tenths of a unit, and
// a search works on a small box of them whose flags say what each grid point holds.
import type { Point } from "./model.js"
import type { Bounds } from "./symbols/index.js"
import { clean } from "./symbols/types.js"

const CELLS_PER_UNIT = 10
/** Slack for deciding whether a coordinate lies on the grid. */
const ON_GRID = 1e-6
/** Off-grid and slanted segments are sampled at this step, in cells, and the grid points around each sample blocked. */
const SAMPLE_STEP = 0.5

/** Nothing may pass or end here. */
export const BLOCK = 1
/** Inside a straight wire of another net: a wire may cross it at a right angle, but not turn or end there. */
export const CROSS = 2
/** The edge from this point to the next point in +x is taken. */
export const EDGE_EAST = 4
/** The edge from this point to the next point in +y is taken. */
export const EDGE_NORTH = 8
export const SOURCE = 16
export const TARGET = 32

/** Integer cell ranges, both ends included. */
export interface CellRect {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export const toCell = (value: number): number => Math.round(value * CELLS_PER_UNIT)
export const fromCell = (cell: number): number => clean(cell / CELLS_PER_UNIT) + 0
const isOnGrid = (value: number): boolean => Math.abs(value * CELLS_PER_UNIT - toCell(value)) < ON_GRID
export const pointOnGrid = (p: Point): boolean => isOnGrid(p.x) && isOnGrid(p.y)

/** The grid points within `margin` of the bounds, edges included. */
export function cellsAround(bounds: Bounds, margin: number): CellRect {
  return {
    minX: Math.ceil((bounds.minX - margin) * CELLS_PER_UNIT - ON_GRID),
    minY: Math.ceil((bounds.minY - margin) * CELLS_PER_UNIT - ON_GRID),
    maxX: Math.floor((bounds.maxX + margin) * CELLS_PER_UNIT + ON_GRID),
    maxY: Math.floor((bounds.maxY + margin) * CELLS_PER_UNIT + ON_GRID),
  }
}

export const overlaps = (a: CellRect, b: CellRect): boolean => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
export const holds = (rect: CellRect, x: number, y: number): boolean => x >= rect.minX && x <= rect.maxX && y >= rect.minY && y <= rect.maxY

/** What a drawn wire puts on the grid: flags as flat [x, y, flag] triples, the grid points it runs through, and its extent. */
export interface WireMarks {
  marks: number[]
  lattice: number[]
  rect: CellRect
}

function markStraight(a: Point, b: Point, into: WireMarks): void {
  const [ax, ay, bx, by] = [toCell(a.x), toCell(a.y), toCell(b.x), toCell(b.y)]
  const [sx, sy] = [Math.sign(bx - ax), Math.sign(by - ay)]
  const steps = Math.abs(bx - ax) + Math.abs(by - ay)
  for (let k = 0; k <= steps; k++) {
    const [x, y] = [ax + sx * k, ay + sy * k]
    into.marks.push(x, y, k === 0 || k === steps ? BLOCK : CROSS)
    into.lattice.push(x, y)
    if (k === steps) continue
    const [lowX, lowY] = [Math.min(x, x + sx), Math.min(y, y + sy)]
    into.marks.push(lowX, lowY, sx !== 0 ? EDGE_EAST : EDGE_NORTH)
  }
}

/** Blocks the grid points around a segment that is off the grid or slanted. */
function markLoose(a: Point, b: Point, into: WireMarks): void {
  const [ax, ay, bx, by] = [a.x * CELLS_PER_UNIT, a.y * CELLS_PER_UNIT, b.x * CELLS_PER_UNIT, b.y * CELLS_PER_UNIT]
  const samples = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / SAMPLE_STEP))
  for (let k = 0; k <= samples; k++) {
    const [x, y] = [ax + ((bx - ax) * k) / samples, ay + ((by - ay) * k) / samples]
    for (const cx of new Set([Math.floor(x + ON_GRID), Math.ceil(x - ON_GRID)])) {
      for (const cy of new Set([Math.floor(y + ON_GRID), Math.ceil(y - ON_GRID)])) into.marks.push(cx, cy, BLOCK)
    }
  }
}

function extentOf(marks: readonly number[]): CellRect {
  const rect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  for (let i = 0; i < marks.length; i += 3) {
    const [x, y] = [marks[i] as number, marks[i + 1] as number]
    rect.minX = Math.min(rect.minX, x)
    rect.maxX = Math.max(rect.maxX, x + 1)
    rect.minY = Math.min(rect.minY, y)
    rect.maxY = Math.max(rect.maxY, y + 1)
  }
  return rect
}

/** The grid marks of a wire through `points`. */
export function wireMarks(points: readonly Point[]): WireMarks {
  const result: WireMarks = { marks: [], lattice: [], rect: { minX: 0, minY: 0, maxX: -1, maxY: -1 } }
  points.slice(1).forEach((b, i) => {
    const a = points[i] as Point
    if (a.x === b.x && a.y === b.y) return
    const straight = (a.x === b.x || a.y === b.y) && pointOnGrid(a) && pointOnGrid(b)
    if (straight) markStraight(a, b, result)
    else markLoose(a, b, result)
  })
  return { ...result, rect: extentOf(result.marks) }
}

/** The flags of the grid points in one search box. */
export class LocalGrid {
  readonly width: number
  readonly height: number
  readonly flags: Uint8Array
  /** The SOURCE points, as local indices in the order they were marked. */
  readonly sources: number[] = []
  /** The extent of the TARGET points, in local cells; empty while there is none. */
  readonly goal: CellRect = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }

  constructor(
    readonly box: CellRect,
    buffer: Uint8Array,
  ) {
    this.width = box.maxX - box.minX + 1
    this.height = box.maxY - box.minY + 1
    this.flags = buffer.subarray(0, this.width * this.height)
    this.flags.fill(0)
  }

  /** The index of a sheet cell, or -1 outside the box. */
  indexOf(x: number, y: number): number {
    return holds(this.box, x, y) ? (y - this.box.minY) * this.width + (x - this.box.minX) : -1
  }

  add(x: number, y: number, flag: number): void {
    const index = this.indexOf(x, y)
    if (index >= 0) this.flags[index] = (this.flags[index] as number) | flag
  }

  /** Marks a SOURCE or TARGET point and keeps the source list and the goal extent up to date. */
  addEnd(x: number, y: number, flag: typeof SOURCE | typeof TARGET): void {
    const index = this.indexOf(x, y)
    if (index < 0 || (this.flags[index] as number) & flag) return
    this.flags[index] = (this.flags[index] as number) | flag
    if (flag === SOURCE) {
      this.sources.push(index)
      return
    }
    const [lx, ly] = [x - this.box.minX, y - this.box.minY]
    this.goal.minX = Math.min(this.goal.minX, lx)
    this.goal.maxX = Math.max(this.goal.maxX, lx)
    this.goal.minY = Math.min(this.goal.minY, ly)
    this.goal.maxY = Math.max(this.goal.maxY, ly)
  }

  remove(x: number, y: number, flag: number): void {
    const index = this.indexOf(x, y)
    if (index >= 0) this.flags[index] = (this.flags[index] as number) & ~flag
  }

  fill(rect: CellRect, flag: number): void {
    const [x0, x1] = [Math.max(rect.minX, this.box.minX), Math.min(rect.maxX, this.box.maxX)]
    const [y0, y1] = [Math.max(rect.minY, this.box.minY), Math.min(rect.maxY, this.box.maxY)]
    for (let y = y0; y <= y1; y++) {
      const row = (y - this.box.minY) * this.width - this.box.minX
      for (let x = x0; x <= x1; x++) this.flags[row + x] = (this.flags[row + x] as number) | flag
    }
  }

  apply(wire: WireMarks): void {
    if (!overlaps(wire.rect, this.box)) return
    const { marks } = wire
    for (let i = 0; i < marks.length; i += 3) this.add(marks[i] as number, marks[i + 1] as number, marks[i + 2] as number)
  }
}
