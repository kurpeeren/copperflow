// The note Export → Fabrication files (JLCPCB) shows: where the files went and the upload step, the warnings, or why
// nothing was written. Pure.
import type { FabricationExport } from "../api.js"

/** How many items of a warning's list the note shows; the rest are counted. */
const SHOWN_ITEMS = 3

/** A warning as "head: item, item, item and N more", from "head: item, item, ...". */
function shortWarning(warning: string): string {
  const split = warning.indexOf(": ")
  if (split === -1) return warning
  const items = warning.slice(split + 2).split(", ")
  if (items.length <= SHOWN_ITEMS) return warning
  return `${warning.slice(0, split)}: ${items.slice(0, SHOWN_ITEMS).join(", ")} and ${items.length - SHOWN_ITEMS} more`
}

export function fabricationNote(result: FabricationExport): string {
  if (!result.written) return `No fabrication files written: ${result.errors.join("; ")}`
  const zip = result.zip.split("/").pop() ?? result.zip
  return [
    `Wrote ${result.files.length} fabrication files to ${result.folder}/ and ${result.zip}.`,
    `Upload ${zip} to JLCPCB.`,
    ...result.warnings.map((warning) => `Warning: ${shortWarning(warning)}.`),
  ].join(" ")
}
