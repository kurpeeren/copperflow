import type { Point } from "../model.js"
import { violation, type Violation } from "./violation.js"

export const mm = (value: number) => value.toFixed(3)
export const gap = (distance: number) => (distance > 0 ? `${mm(distance)} mm apart` : "touching or overlapping")

/**
 * A copper error. Its id is the code and the `key` parts joined by "|" in the order given
 * (`copper-clearance:t0001|t0002`), so it stays the same from build to build; `items` are sorted.
 */
export function copperViolation(code: string, message: string, key: readonly string[], items: readonly string[], at: Point): Violation {
  return { ...violation(code, "error", message, items, "pcb", at), id: `${code}:${key.join("|")}` }
}
