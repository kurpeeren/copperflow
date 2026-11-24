// A perfboard or stripboard fitted round its parts in whole holes, with free holes all round, keeping the hole
// lattice where it is so that parts already on holes stay on them. Pure.
import type { Point } from "../model.js"
import { MAX_HOLES, MIN_HOLES, type ProtoGrid } from "./grid.js"

/** Free holes left round the parts. */
export const FIT_MARGIN_HOLES = 1
const EPS = 1e-6

export interface ProtoFit {
  columns: number
  rows: number
  /** The board's new centre, on the same lattice as before. */
  centre: Point
}

/** The holes round the points (courtyard corners) with `margin` free holes beyond, or why there are none. */
export function fitProto(grid: ProtoGrid, points: readonly Point[], margin = FIT_MARGIN_HOLES): ProtoFit | { error: string } {
  if (points.length === 0) return { error: "there are no parts to fit the board to" }
  const p = grid.pitch
  const xs = points.map((q) => q.x)
  const ys = points.map((q) => q.y)
  // A hole's square reaches half a pitch each way: the board's edge holes reach past the parts.
  const firstCol = Math.floor((Math.min(...xs) - grid.first.x) / p + 0.5 + EPS) - margin
  const lastCol = Math.ceil((Math.max(...xs) - grid.first.x) / p - 0.5 - EPS) + margin
  const firstRow = Math.floor((grid.first.y - Math.max(...ys)) / p + 0.5 + EPS) - margin
  const lastRow = Math.ceil((grid.first.y - Math.min(...ys)) / p - 0.5 - EPS) + margin
  const columns = Math.max(lastCol - firstCol + 1, MIN_HOLES)
  const rows = Math.max(lastRow - firstRow + 1, MIN_HOLES)
  if (columns > MAX_HOLES || rows > MAX_HOLES) return { error: `the parts need ${columns} x ${rows} holes, more than ${MAX_HOLES} a side` }
  const round = (v: number) => Math.round(v * 10_000) / 10_000 || 0
  return { columns, rows, centre: { x: round(grid.first.x + ((firstCol + firstCol + columns - 1) / 2) * p), y: round(grid.first.y - ((firstRow + firstRow + rows - 1) / 2) * p) } }
}
