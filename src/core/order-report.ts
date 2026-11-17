// "Is this board ready to order?" in plain lines, the same for the bom tool and command, the end of the fabrication
// export, the package's README and the Studio's BOM section. Pure: it reads a built design and its BOM lines. It
// checks only what copperflow knows: no price, no stock, nothing fetched.
import type { Design } from "../engine/design.js"
import { fabricationErrors } from "../engine/fab/export.js"
import { naturalCompare } from "../engine/order.js"
import type { BomLine } from "./bom.js"
import { checkDesign } from "./check.js"

/** The most lines the report takes; the lines without a supplier part number are cut to fit, with a count. */
export const ORDER_REPORT_MAX_LINES = 40

const PLACEHOLDER_CODE = "footprint-placeholder"
const counted = (n: number, word: string, plural = `${word}s`) => `${n} ${n === 1 ? word : plural}`
const BUILT_IN_HOW =
  'Add a number to a built-in part: set_props { part, props: { supplierPartNumbers: "jlcpcb:<number>" } } in the file that writes it (a sheet\'s part by its name in the .sheet.tsx).'
const LIBRARY_HOW =
  'Add a number to a library part: suppliers: { jlcpcb: "<number>" } in parts/<id>/part.yaml, then copperflow parts build (or create_part again with replace); a person then verifies it again.'
const NO_PRICE = "No price or stock is checked: copperflow stores neither."
const HONEST = '"Ready" covers only the lines above: it does not say the board works or that a maker will accept it.'

const round = (mm: number) => String(Math.round(mm * 10) / 10)

function boardLine(design: Design): string {
  const board = design.circuit.board
  const outline = board?.outline ?? []
  const layers = `${board?.layers ?? 2} layers`
  const check = checkDesign(design)
  const errors = check.errors.reduce((sum, group) => sum + group.count, 0)
  const warnings = check.warnings.length === 0 ? "no warnings" : `warnings: ${check.warnings.map((group) => `${group.type} ${group.count}`).join(", ")}`
  const checks = `Checks: ${counted(errors, "error")}, ${counted(design.pcb.ratsnest.length, "unrouted connection")}, ${warnings}.`
  if (outline.length < 3) return `Board: no outline, ${layers}. ${checks}`
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  return `Board: ${round(Math.max(...xs) - Math.min(...xs))} x ${round(Math.max(...ys) - Math.min(...ys))} mm, ${layers}. ${checks}`
}

/** What makes the fabrication export refuse the design or the bare board wrong; empty when there is nothing. */
function bareBoardReasons(design: Design): string[] {
  const errors = fabricationErrors(design).length
  const placeholders = design.diagnostics.filter((d) => d.code === PLACEHOLDER_CODE).flatMap((d) => d.items)
  const unrouted = design.pcb.ratsnest.length
  return [
    ...(errors > 0 ? [counted(errors, "error")] : []),
    ...(unrouted > 0 ? [counted(unrouted, "unrouted connection")] : []),
    ...(placeholders.length > 0 ? [`a placeholder footprint (${[...placeholders].sort(naturalCompare).join(", ")})`] : []),
    ...((design.circuit.board?.outline.length ?? 0) < 3 ? ["no board outline"] : []),
  ]
}

const verdict = (what: string, reasons: readonly string[]) => `Ready for ${what}: ${reasons.length === 0 ? "yes" : `no: ${reasons.join("; ")}`}`

const describeLine = (line: BomLine) => `  ${line.designators.join(", ")}: ${[line.kind, line.value, line.footprint].filter((s) => s !== "").join(" ")}`

function unverifiedParts(bom: readonly BomLine[]): string[] {
  const parts = new Map<string, string[]>()
  for (const line of bom.filter((l) => l.libraryPart !== undefined && l.verified !== true)) {
    const id = line.libraryPart as string
    parts.set(id, [...(parts.get(id) ?? []), ...line.designators])
  }
  return [...parts.entries()].sort(([a], [b]) => naturalCompare(a, b)).map(([id, designators]) => `${id} (${designators.sort(naturalCompare).join(", ")})`)
}

function throughHoleParts(design: Design): string[] {
  return design.pcb.parts
    .filter((part) => part.footprint?.pads.some((pad) => pad.layers === "through"))
    .map((part) => part.component)
    .sort(naturalCompare)
}

function assemblyReasons(bom: readonly BomLine[], missing: number, unverified: number): string[] {
  return [
    ...(missing > 0 ? [`${missing} of ${bom.length} ${bom.length === 1 ? "line has" : "lines have"} no supplier part number`] : []),
    ...(unverified > 0 ? [`${counted(unverified, "library part is", "library parts are")} not verified`] : []),
  ]
}

/** The report's lines, at most ORDER_REPORT_MAX_LINES. */
export function orderReportLines(design: Design, bom: readonly BomLine[]): string[] {
  const missing = bom.filter((line) => line.supplier === "")
  const unverified = unverifiedParts(bom)
  const through = throughHoleParts(design)
  const head = [
    `Order report for ${design.file}`,
    boardLine(design),
    verdict("bare boards", bareBoardReasons(design)),
    `BOM: ${counted(bom.length, "line")}, ${bom.length - missing.length} with a supplier part number.${missing.length > 0 ? " Without one:" : ""}`,
  ]
  const tail = [
    ...(unverified.length > 0 ? [`Not verified: ${unverified.join(", ")}. A person should check them against their datasheets before ordering.`] : []),
    `Through-hole: ${through.length > 0 ? through.join(", ") : "none"}`,
    verdict("assembly", assemblyReasons(bom, missing.length, unverified.length)),
    ...(missing.some((line) => line.libraryPart === undefined) ? [BUILT_IN_HOW] : []),
    ...(missing.some((line) => line.libraryPart !== undefined) ? [LIBRARY_HOW] : []),
    NO_PRICE,
    HONEST,
  ]
  const room = ORDER_REPORT_MAX_LINES - head.length - tail.length
  const listed = missing.length <= room ? missing.map(describeLine) : [...missing.slice(0, room - 1).map(describeLine), `  … and ${missing.length - (room - 1)} more`]
  return [...head, ...listed, ...tail]
}

/** The report as text; `short` keeps the two verdicts and says where the whole report is. */
export function formatOrderReport(design: Design, bom: readonly BomLine[], options: { short?: boolean } = {}): string {
  const lines = orderReportLines(design, bom)
  if (!options.short) return lines.join("\n")
  return [...lines.filter((line) => line.startsWith("Ready for ")), `The whole order report: the bom tool, or copperflow bom ${design.file}.`].join("\n")
}
