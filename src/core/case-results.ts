// The last result of each sheet's cases in this process, by sheet name: simulate records them, list_modules { name } shows them.
// Kept in memory only: a result belongs to the session that ran it, never to the module's files.
import type { CaseLine } from "../engine/sim/cases.js"

const results = new Map<string, Map<string, CaseLine>>()

export function recordCaseResults(sheet: string, lines: readonly CaseLine[]): void {
  results.set(sheet, new Map(lines.map((line) => [line.name, line])))
}

/** The last result of a case, or undefined when it has not run in this session. */
export function lastCaseResult(sheet: string, name: string): CaseLine | undefined {
  return results.get(sheet)?.get(name)
}
