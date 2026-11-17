// The note Export → Fabrication files (JLCPCB) shows: where the files went and the upload step (the zip to the PCB
// order, the BOM and pick-and-place CSVs to the assembly step), the warnings, or why
// nothing was written. Pure.
import { uploadStep } from "../../../src/engine/fab/names.js"
import { checksLine, type CheckCounts } from "../../../src/core/checks-line.js"
import type { FabricationExport } from "../api.js"

/** How many warnings the note shows, each in full; the rest are counted. */
const SHOWN_WARNINGS = 3

function warningLines(warnings: readonly string[]): string[] {
  const shown = warnings.slice(0, SHOWN_WARNINGS).map((warning) => `Warning: ${warning}.`)
  const more = warnings.length - SHOWN_WARNINGS
  return more > 0 ? [...shown, `And ${more} more ${more === 1 ? "warning" : "warnings"}.`] : shown
}

export function fabricationNote(result: FabricationExport): string {
  if (!result.written) return `No fabrication files written: ${result.errors.join("; ")}`
  const upload = uploadStep(result.zip, result.folder, result.files)
  const model = result.model === undefined ? [] : [result.model]
  return [`Wrote ${result.files.length} fabrication files to ${result.folder}/ and ${result.zip}.`, `U${upload.slice(1)}.`, ...model, ...warningLines(result.warnings), checksLine(result.checks)].join(" ")
}

/** Whether Export → Fabrication files asks first: when the checks report errors. */
export function exportAsks(checks: CheckCounts): boolean {
  return checks.errors > 0
}

const counted = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** What the export asks when the checks report errors; the buttons are Show checks and Export anyway. */
export function exportChecksQuestion(checks: CheckCounts): string {
  return `The design rule check reports ${counted(checks.errors, "error")} and ${counted(checks.warnings, "warning")}. Look at them before you order this board.`
}
