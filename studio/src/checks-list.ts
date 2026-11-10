// The rows of the DRC tab: the build's violations and diagnostics, errors first, grouped by code,
// and the violations each canvas marks.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Violation } from "../../src/engine/checks/violation.js"
import type { Design } from "../../src/engine/design.js"
import type { Diagnostic, Point, Severity } from "../../src/engine/model.js"
import type { RouteEvent } from "../../src/studio/route-events.js"
import type { ViolationMarker } from "./pcb/markers.js"
import { boardItemCentre } from "./pcb/pour-hit.js"

export interface CheckRow {
  /** The violation's id; a diagnostic has none and gets one from its place in the list. */
  id: string
  severity: Severity
  code: string
  message: string
  items: string[]
  /** Where the row points: a canvas, or the code for a diagnostic. */
  view: "pcb" | "schematic" | "code"
  at?: Point
  /** The component the row names first, when the design has it; clicking the row selects it. */
  part?: string
  /** The design's tracks and vias the row names, in item order; clicking the row selects them instead of a part. */
  copper?: string[]
  /** The design's copper pours and holes the row names (`copperpour:1`, `hole:1`), selected with the copper. */
  board?: string[]
}

export interface CheckGroup {
  code: string
  /** An error when any of its rows is one. */
  severity: Severity
  rows: CheckRow[]
}

export interface CheckCounts {
  errors: number
  warnings: number
}

export const NO_PROBLEMS = "No problems found."

const rank = (severity: Severity): number => (severity === "error" ? 0 : 1)

/** Named nets (`net.GND`), and ids with a colon: unnamed nets (`net:R1.pin1`), keepouts (`keepout:1`) and whole violation ids. */
const namesNoPart = (item: string): boolean => item.startsWith("net.") || item.includes(":")

/** The component of the first item that names one: a pad `R1#1` or a pin `R1.pin1` gives `R1`; a plain item is a component. */
export function partOf(row: Pick<CheckRow, "items">): string | undefined {
  const item = row.items.find((candidate) => !namesNoPart(candidate))
  const part = item?.split(/[#.]/, 1)[0]
  return part ? part : undefined
}

/**
 * `partOf(row)` when the design has a component with that id, otherwise nothing: items such as
 * `rules.yaml`, a net class's name, `board` or `keepout` read like components but are not.
 */
export function selectablePart(row: Pick<CheckRow, "items">, components: ReadonlySet<string>): string | undefined {
  const part = partOf(row)
  return part !== undefined && components.has(part) ? part : undefined
}

/**
 * A row naming copper, pours or holes selects them, and one about a pour or hole without a position is ringed at it;
 * any other row selects the part it names.
 */
function withPart(row: CheckRow, components: ReadonlySet<string>, copperIds: ReadonlySet<string>, design: Design): CheckRow {
  const copper = row.items.filter((item) => copperIds.has(item))
  const board = row.items.filter((item) => boardIdsOf(design).has(item))
  const at = row.at ?? (row.view === "pcb" ? board.map((id) => boardItemCentre(design, id)).find((point) => point !== undefined) : undefined)
  if (copper.length > 0 || board.length > 0) return { ...row, ...(copper.length > 0 ? { copper } : {}), ...(board.length > 0 ? { board } : {}), ...(at ? { at } : {}) }
  const part = selectablePart(row, components)
  return part === undefined ? row : { ...row, part }
}

/** The ids of the design's copper pours and holes. */
function boardIdsOf(design: Design): Set<string> {
  const pcb = design.pcb as Design["pcb"] | undefined
  return new Set([...(pcb?.board?.pours ?? []), ...(pcb?.holes ?? [])].map((item) => item.id))
}

/** The ids of the design's tracks and vias. */
function copperIdsOf(design: Design): Set<string> {
  const pcb = design.pcb as Design["pcb"] | undefined
  return new Set([...(pcb?.tracks ?? []), ...(pcb?.vias ?? [])].map((item) => item.id))
}

function violationRow(v: Violation): CheckRow {
  const row: CheckRow = { id: v.id, severity: v.severity, code: v.code, message: v.message, items: v.items, view: v.view }
  return v.at ? { ...row, at: v.at } : row
}

const diagnosticRow = (d: Diagnostic, index: number): CheckRow => ({
  id: `diagnostic:${index}`,
  severity: d.severity,
  code: d.code,
  message: d.message,
  items: d.items,
  view: "code",
})

const pair = (a: string, b: string) => (a < b ? `${a} ${b}` : `${b} ${a}`)

/**
 * After a Route → Autoroute run: each connection it could not route, with the router's reason, at the middle of its
 * ratsnest line, for as long as the ratsnest still has the connection.
 */
function routeRows(design: Design, route: RouteEvent | undefined): CheckRow[] {
  if (route?.state !== "done") return []
  const lines = new Map(design.pcb.ratsnest.map((line) => [pair(line.from, line.to), line]))
  return route.unrouted.flatMap((connection) => {
    const line = lines.get(pair(connection.from, connection.to))
    if (line === undefined) return []
    const at = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 }
    return [{ id: `route:${connection.from}:${connection.to}`, severity: "warning" as const, code: "unrouted", message: connection.reason, items: [connection.from, connection.to, ...connection.blockers], view: "pcb" as const, at }]
  })
}

/** Violations, the last Autoroute run's unrouted connections, then diagnostics (view `code`), with every error before every warning. */
export function checkRows(design: Design, route?: RouteEvent): CheckRow[] {
  const components = new Set(design.circuit.components.map((component) => component.id))
  const copperIds = copperIdsOf(design)
  const rows = [...design.violations.map(violationRow), ...routeRows(design, route), ...design.diagnostics.map(diagnosticRow)].map((row) => withPart(row, components, copperIds, design))
  return rows.sort((a, b) => rank(a.severity) - rank(b.severity))
}

/** One group per code, in the order the codes first appear, so groups with errors come first. */
export function checkGroups(rows: readonly CheckRow[]): CheckGroup[] {
  const codes = [...new Set(rows.map((row) => row.code))]
  return codes.map((code) => {
    const members = rows.filter((row) => row.code === code)
    return { code, severity: members.some((row) => row.severity === "error") ? "error" : "warning", rows: members }
  })
}

/** The view's rows that have a position, as the canvas rings them. */
export function markersFor(rows: readonly CheckRow[], view: "pcb" | "schematic"): ViolationMarker[] {
  return rows.flatMap((row) => (row.view === view && row.at ? [{ id: row.id, at: row.at, severity: row.severity }] : []))
}

export function checkCounts(rows: readonly CheckRow[]): CheckCounts {
  const errors = rows.filter((row) => row.severity === "error").length
  return { errors, warnings: rows.length - errors }
}

const counted = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`

/** "2 errors, 1 warning", or NO_PROBLEMS. */
export function checkSummary({ errors, warnings }: CheckCounts): string {
  const parts = [...(errors > 0 ? [counted(errors, "error")] : []), ...(warnings > 0 ? [counted(warnings, "warning")] : [])]
  return parts.length === 0 ? NO_PROBLEMS : parts.join(", ")
}
