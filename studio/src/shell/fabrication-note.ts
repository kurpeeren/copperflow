// The note Export → Fabrication files (JLCPCB) shows: where the files went and the upload step (the zip to the PCB
// order, the BOM and pick-and-place CSVs to the assembly step), the warnings, or why
// nothing was written. Pure.
import { uploadStep } from "../../../src/engine/fab/names.js"
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
  return [`Wrote ${result.files.length} fabrication files to ${result.folder}/ and ${result.zip}.`, `U${upload.slice(1)}.`, ...warningLines(result.warnings)].join(" ")
}
