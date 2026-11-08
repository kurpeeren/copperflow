// The bill of materials as a CSV file, for File → Export BOM.
import type { BomLine } from "../api.js"

const HEADER = ["Designators", "Quantity", "Value", "Footprint", "Manufacturer", "MPN", "Supplier part", "Verified"]

/** Quotes a field when it holds a comma, a quote or a line break, as RFC 4180 does. */
function field(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** One row per BOM line, with a header row; lines end with CRLF, as spreadsheets expect. */
export function bomCsv(lines: readonly BomLine[]): string {
  const rows = lines.map((line) => [
    line.designators.join(" "),
    String(line.quantity),
    line.value || line.kind,
    line.footprint,
    line.manufacturer,
    line.mpn,
    line.supplier,
    line.libraryPart ? (line.verified ? "yes" : "no") : "",
  ])
  return [HEADER, ...rows].map((row) => row.map(field).join(",")).join("\r\n") + "\r\n"
}

/** The file name for a circuit file's BOM: `usb.circuit.tsx` → `usb-bom.csv`. */
export function bomFileName(file: string): string {
  const base = file.split(/[\\/]/).at(-1) ?? file
  return `${base.replace(/\.circuit\.tsx$|\.tsx$/, "")}-bom.csv`
}
