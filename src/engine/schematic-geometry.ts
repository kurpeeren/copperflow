// Sheet geometry shared by placement and layout: quarter turns, symbol bounds on the sheet, and the 0.1 grid.
import type { Point, Side } from "./model.js"
import type { Bounds } from "./symbols/index.js"
import { clean } from "./symbols/types.js"

export const GRID = 0.1
/** Counter-clockwise order, so a quarter turn moves one step on. */
const SIDES: readonly Side[] = ["right", "top", "left", "bottom"]

/** Where a symbol's origin sits on the sheet and how far it is turned. */
export interface Spot {
  x: number
  y: number
  rotation: number
}

/** Removes floating-point noise and negative zero so that coordinates compare exactly. */
export const tidy = (value: number): number => clean(value) + 0

const turnsOf = (rotation: number): number => Math.round((((rotation % 360) + 360) % 360) / 90) % 4

/** Counter-clockwise quarter turns, y up. */
export function rotatePoint(p: Point, rotation: number): Point {
  switch (turnsOf(rotation)) {
    case 1:
      return { x: tidy(-p.y), y: tidy(p.x) }
    case 2:
      return { x: tidy(-p.x), y: tidy(-p.y) }
    case 3:
      return { x: tidy(p.y), y: tidy(-p.x) }
    default:
      return { x: tidy(p.x), y: tidy(p.y) }
  }
}

export function rotateSide(side: Side, rotation: number): Side {
  return SIDES[(SIDES.indexOf(side) + turnsOf(rotation)) % 4] ?? side
}

export function sheetPoint(p: Point, at: Spot): Point {
  const turned = rotatePoint(p, at.rotation)
  return { x: tidy(at.x + turned.x), y: tidy(at.y + turned.y) }
}

/** The box around the rotated corners of the bounds, relative to the origin. */
export function turnedBounds(bounds: Bounds, rotation: number): Bounds {
  const corners = [
    { x: bounds.minX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.minY },
    { x: bounds.maxX, y: bounds.maxY },
    { x: bounds.minX, y: bounds.maxY },
  ].map((corner) => rotatePoint(corner, rotation))
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
}

/** The symbol's bounds on the sheet, turned and moved to its spot. */
export function sheetBounds(bounds: Bounds, at: Spot): Bounds {
  const turned = turnedBounds(bounds, at.rotation)
  return { minX: tidy(at.x + turned.minX), maxX: tidy(at.x + turned.maxX), minY: tidy(at.y + turned.minY), maxY: tidy(at.y + turned.maxY) }
}

export const snapDown = (value: number): number => tidy(Math.floor(value / GRID + 1e-9) * GRID)
export const snapUp = (value: number): number => tidy(Math.ceil(value / GRID - 1e-9) * GRID)
/** The nearest grid point; halves go up. */
export const snap = (value: number): number => tidy(Math.round(value / GRID + 1e-9) * GRID)
