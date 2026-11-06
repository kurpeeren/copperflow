/**
 * Lengths closer than this, in mm, count as equal: far below any fabrication limit, far above
 * floating-point noise. A part placed exactly at a limit then passes.
 */
export const LENGTH_TOLERANCE = 1e-6

/** True when `value` is smaller than the minimum `min` by more than the tolerance. NaN breaks every minimum. */
export function breaksMinimum(value: number, min: number): boolean {
  return !(value >= min - LENGTH_TOLERANCE)
}
