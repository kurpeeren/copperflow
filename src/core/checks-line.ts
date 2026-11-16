// The line an export adds about the circuit's rule checks; for the CLI, the MCP tool and the Studio's note. Pure.

/** The error and warning counts of the circuit's rule checks, the ones check_circuit reports. */
export interface CheckCounts {
  errors: number
  warnings: number
}

const counted = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** The checks' counts in one line; with errors, what to do before the board is ordered. The export is not refused. */
export function checksLine(checks: CheckCounts): string {
  const counts = `Checks: ${counted(checks.errors, "error")}, ${counted(checks.warnings, "warning")}.`
  return checks.errors > 0 ? `${counts} Run check_circuit (or copperflow check <file>) and fix the errors before anyone orders this board.` : counts
}
