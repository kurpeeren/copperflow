import type { Diagnostic, Severity, SourceRef } from "./model.js"
import { sortedNatural } from "./order.js"

export function diagnostic(code: string, severity: Severity, message: string, items: readonly string[], source?: SourceRef): Diagnostic {
  const base = { code, severity, message, items: sortedNatural(items) }
  return source ? { ...base, source } : base
}
