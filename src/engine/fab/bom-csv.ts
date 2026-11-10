// The bill of materials in JLCPCB's columns (Comment, Designator, Footprint, LCSC Part #), one row per line of the
// BOM copperflow already builds. Pure.
import type { BomLine } from "../../core/bom.js"
import { csvCell } from "./csv.js"

export const JLCPCB_BOM_COLUMNS = ["Comment", "Designator", "Footprint", "LCSC Part #"] as const

/** The suppliers whose part numbers are LCSC's: JLCPCB assembles from the LCSC catalogue. */
const LCSC_SUPPLIER = /^(jlcpcb|lcsc)\s+(\S+)$/i

/** The LCSC number of a line's supplier part ("jlcpcb C9657" gives "C9657"), or "" for another supplier. */
const lcscNumber = (supplier: string): string => LCSC_SUPPLIER.exec(supplier.trim())?.[2] ?? ""

/** The comment JLCPCB shows for a line: its value, else its MPN, else its kind. */
const comment = (line: BomLine): string => line.value || line.mpn || line.kind

export function jlcpcbBomCsv(lines: readonly BomLine[]): string {
  const rows = lines.map((line) => [comment(line), line.designators.join(","), line.footprint, lcscNumber(line.supplier)])
  return `${[[...JLCPCB_BOM_COLUMNS], ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`
}
