import type { Board } from "../model.js"

/**
 * Lengths closer than this, in mm, count as equal: far below any fabrication limit, far above
 * floating-point noise. A part placed exactly at a limit then passes.
 */
export const LENGTH_TOLERANCE = 1e-6

/** An outline needs this many corners to enclose anything. */
const MIN_OUTLINE_POINTS = 3

/** True when `value` is smaller than the minimum `min` by more than the tolerance. NaN breaks every minimum. */
export function breaksMinimum(value: number, min: number): boolean {
  return !(value >= min - LENGTH_TOLERANCE)
}

/** True when there is a board whose outline has at least 3 corners, so checks can measure against it. */
export function usableOutline(board: Board | undefined): boolean {
  return board !== undefined && board.outline.length >= MIN_OUTLINE_POINTS
}
