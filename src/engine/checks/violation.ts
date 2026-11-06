import type { Point, Severity } from "../model.js"
import { sortedNatural } from "../order.js"

/** A design-rule finding. `id` is the code and the items, so it stays the same from build to build. */
export interface Violation {
  id: string
  code: string
  severity: Severity
  message: string
  /** Natural sort order. */
  items: string[]
  view: "pcb" | "schematic"
  /** Where to point at it, when there is one place. */
  at?: Point
}

export function violation(code: string, severity: Severity, message: string, items: readonly string[], view: "pcb" | "schematic", at?: Point): Violation {
  const sorted = sortedNatural(items)
  const base = { id: `${code}:${sorted.join(",")}`, code, severity, message, items: sorted, view }
  return at === undefined ? base : { ...base, at }
}
