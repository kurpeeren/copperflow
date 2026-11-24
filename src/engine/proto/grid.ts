// The hole grid of a perfboard or a stripboard: 2.54 mm holes in rows and columns. Rows are letters from the top (A, B,
// …, Z, AA, …), columns numbers from the left, so "C7" is row C, column 7; the names read the same from both sides.
// Pure: no file system, no state.
import type { Point } from "../model.js"

export const PROTO_KINDS = ["perfboard", "stripboard"] as const
export type ProtoKind = (typeof PROTO_KINDS)[number]
/** Which way a stripboard's strips run: along the rows (the default) or down the columns. */
export type StripRun = "rows" | "columns"

/** The hole pitch, in mm. */
export const PITCH = 2.54
/** The fewest and most holes a side may have. */
export const MIN_HOLES = 2
export const MAX_HOLES = 200
/** How far a pad may lie from a hole and still go in it: a lead bends that far. */
export const ON_HOLE = 0.25

export interface ProtoGrid {
  kind: ProtoKind
  columns: number
  rows: number
  pitch: number
  /** The centre of hole A1, the top left one. */
  first: Point
  /** Stripboard only. */
  strips?: StripRun
}

/** A hole by its column and row, both from 0. */
export interface Hole {
  col: number
  row: number
}

const LETTERS = 26
const A = "A".charCodeAt(0)

/** 0 → A, 25 → Z, 26 → AA, 27 → AB, … */
export function rowName(row: number): string {
  let name = ""
  let left = row + 1
  while (left > 0) {
    const digit = (left - 1) % LETTERS
    name = String.fromCharCode(A + digit) + name
    left = Math.floor((left - 1) / LETTERS)
  }
  return name
}

/** A → 0, Z → 25, AA → 26; undefined for anything else. */
export function rowIndex(name: string): number | undefined {
  if (!/^[A-Z]+$/.test(name)) return undefined
  let value = 0
  for (const char of name) value = value * LETTERS + (char.charCodeAt(0) - A + 1)
  return value - 1
}

/** "C7" for column 6, row 2. */
export const holeName = (hole: Hole): string => `${rowName(hole.row)}${hole.col + 1}`

/** "C7" → { col: 6, row: 2 }; undefined when it is not a hole name. */
export function parseHole(name: string): Hole | undefined {
  const found = /^([A-Z]+)([1-9]\d*)$/.exec(name)
  if (!found) return undefined
  const row = rowIndex(found[1] as string)
  return row === undefined ? undefined : { col: Number(found[2]) - 1, row }
}

export const inGrid = (grid: Pick<ProtoGrid, "columns" | "rows">, hole: Hole): boolean =>
  Number.isInteger(hole.col) && Number.isInteger(hole.row) && hole.col >= 0 && hole.row >= 0 && hole.col < grid.columns && hole.row < grid.rows

/** The centre of a hole in board mm (y up, so row A has the largest y). */
export const holePoint = (grid: ProtoGrid, hole: Hole): Point => ({ x: grid.first.x + hole.col * grid.pitch, y: grid.first.y - hole.row * grid.pitch })

/** The hole nearest a point, kept inside the grid, and how far the point is from it. */
export function nearestHole(grid: ProtoGrid, p: Point): { hole: Hole; distance: number } {
  const clamp = (v: number, max: number) => Math.min(Math.max(Math.round(v), 0), max - 1)
  const hole = { col: clamp((p.x - grid.first.x) / grid.pitch, grid.columns), row: clamp((grid.first.y - p.y) / grid.pitch, grid.rows) }
  const centre = holePoint(grid, hole)
  return { hole, distance: Math.hypot(p.x - centre.x, p.y - centre.y) }
}

/** The grid centred on a point: the outer holes half a pitch inside the edge. */
export function gridAround(kind: ProtoKind, columns: number, rows: number, centre: Point, strips?: StripRun): ProtoGrid {
  const first = { x: centre.x - ((columns - 1) * PITCH) / 2, y: centre.y + ((rows - 1) * PITCH) / 2 }
  return { kind, columns, rows, pitch: PITCH, first, ...(kind === "stripboard" ? { strips: strips ?? "rows" } : {}) }
}

/** The board's outline: the grid with half a pitch all round, counter-clockwise from the bottom left. */
export function gridOutline(grid: ProtoGrid): Point[] {
  const half = grid.pitch / 2
  const left = grid.first.x - half
  const top = grid.first.y + half
  const right = left + grid.columns * grid.pitch
  const bottom = top - grid.rows * grid.pitch
  return [
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: right, y: top },
    { x: left, y: top },
  ]
}

/** The number of holes a length in mm needs, at least MIN_HOLES. */
export const holesFor = (mm: number): number => Math.max(MIN_HOLES, Math.ceil(mm / PITCH - 1e-9))

/** A hole's key in maps: row * columns + col. */
export const holeKey = (grid: Pick<ProtoGrid, "columns">, hole: Hole): number => hole.row * grid.columns + hole.col
export const holeOfKey = (grid: Pick<ProtoGrid, "columns">, key: number): Hole => ({ col: key % grid.columns, row: Math.floor(key / grid.columns) })

/** The hole after this one along the strip it lies on (stripboard), or undefined at the end. */
export function alongStrip(grid: ProtoGrid, hole: Hole): Hole | undefined {
  const next = grid.strips === "columns" ? { col: hole.col, row: hole.row + 1 } : { col: hole.col + 1, row: hole.row }
  return inGrid(grid, next) ? next : undefined
}

/** Whether two holes are neighbours: one step across or down. */
export const neighbours = (a: Hole, b: Hole): boolean => Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1

/** Whether two neighbouring holes lie on one strip of a stripboard. */
export const sameStrip = (grid: ProtoGrid, a: Hole, b: Hole): boolean => (grid.strips === "columns" ? a.col === b.col : a.row === b.row)

/** "strip C" for a row strip, "strip 7" for a column strip. */
export const stripName = (grid: ProtoGrid, hole: Hole): string => (grid.strips === "columns" ? `strip ${hole.col + 1}` : `strip ${rowName(hole.row)}`)
