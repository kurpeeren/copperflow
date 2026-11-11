// board_summary: the board in words, the model's eyes on the layout. Board size and layers, the share of the board the
// courtyards take, a line per part, the longest connections with their pads, placement findings, pours and the unrouted count; the
// default answer stops at about 60 lines and the rest is behind detail "full".
import type { Design } from "../engine/design.js"
import type { Point } from "../engine/model.js"
import { naturalCompare } from "../engine/order.js"
import { connectionPlace, padsById, unplacedParts } from "../engine/pad-text.js"
import type { PlacedFootprint, RatsnestLine } from "../engine/pcb.js"
import { ratsnest } from "../engine/ratsnest.js"
import { netLabel } from "./copper-under.js"

/** board_summary stops near here, so the answer fits a screen. */
export const BOARD_SUMMARY_LIMIT = 60
const LONGEST_SHOWN = 10
/** The finding lists name at most this many parts each in the default answer. */
const FINDINGS_SHOWN = 10

export const BOARD_SUMMARY_DESCRIPTION =
  'The board in words, in about 60 lines: board size and layers, the share the courtyards use, one line per part ("U1 MCP2515 soic18w @(12.0, 8.5) r90 top [LOCKED]"; "not placed" for a part without a position), the ten longest connections, routed or not, with their net, both pads and where they are ("OSC1: U1.pin8 (4.20, 6.10 top) to Y1.pin1 (18.30, 5.90 top) 25.2 mm", "unrouted" when no copper joins them; a part far from the pin it serves shows here), overlapping courtyards, parts off the board or within the edge clearance, pours per layer and the unrouted count. Long part lists end with "… and N more parts (detail: full)"; detail "full" lists everything.'

export type BoardDetail = "compact" | "full"

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const mm = (v: number) => (Math.round(v * 10) / 10).toFixed(1)

/** The area of a closed polygon (shoelace), in mm². */
function polygonArea(points: readonly Point[]): number {
  let twice = 0
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length] as Point
    twice += p.x * q.y - q.x * p.y
  })
  return Math.abs(twice) / 2
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length2 = dx * dx + dy * dy
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Whether a point lies inside a polygon (even-odd rule). */
function inside(p: Point, polygon: readonly Point[]): boolean {
  let within = false
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length] as Point
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) within = !within
  })
  return within
}

/** The least distance from each corner of `from` to the edges of `to`. */
function cornerDistance(from: readonly Point[], to: readonly Point[]): number {
  let least = Infinity
  for (const p of from) to.forEach((a, i) => (least = Math.min(least, segmentDistance(p, a, to[(i + 1) % to.length] as Point))))
  return least
}

/**
 * The least distance between a courtyard and the outline's edges, both ways round: a courtyard corner near an edge, or
 * an outline corner near (or inside, 0) the courtyard, as a notch in the board does.
 */
export function edgeDistance(courtyard: readonly Point[], outline: readonly Point[]): number {
  if (outline.some((corner) => inside(corner, courtyard))) return 0
  return Math.min(cornerDistance(courtyard, outline), cornerDistance(outline, courtyard))
}

function sizeLine(design: Design): string {
  const board = design.pcb.board
  const outline = board?.outline ?? []
  const parts = design.pcb.parts
  const count = `${plural(parts.length, "part")}, ${plural(design.circuit.nets.length, "net")}`
  if (outline.length < 3) return `No board outline; ${count}`
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  const used = parts.reduce((sum, p) => sum + (p.courtyard.length >= 3 ? polygonArea(p.courtyard) : 0), 0)
  const share = Math.round((used / Math.max(polygonArea(outline), 1e-9)) * 100)
  return `Board ${mm(Math.max(...xs) - Math.min(...xs))} × ${mm(Math.max(...ys) - Math.min(...ys))} mm, ${board?.layers ?? 2} layers, courtyards use ${share}%; ${count}`
}

/** "U1 MCP2515 soic18w @(12.0, 8.5) r90 top [LOCKED]"; a part the build packed says "not placed". */
export function partLine(design: Design, part: PlacedFootprint, locked: ReadonlySet<string>): string {
  const component = design.circuit.components.find((c) => c.id === part.component)
  const value = component?.value ?? component?.mpn ?? component?.kind ?? "?"
  const footprint = component?.footprint ?? part.footprint?.name ?? "?"
  const where = part.autoPlaced ? "not placed" : `@(${mm(part.x)}, ${mm(part.y)}) r${part.rotation} ${part.side}`
  return `${part.component} ${value} ${footprint} ${where}${locked.has(part.component) ? " [LOCKED]" : ""}`
}

const lineLength = (line: RatsnestLine) => Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y)
const lineKey = (line: RatsnestLine) => `${line.net}|${line.from}|${line.to}`

/**
 * The longest connections, routed or not, each with its two pads and where they are, so a part far from the pin it
 * serves shows: "OSC1: U1.pin8 (4.20, 6.10 top) to Y1.pin1 (18.30, 5.90 top) 25.2 mm". The connections are the
 * ratsnest with copper ignored, measured pad to pad in a straight line; a poured net's routed ones are left out (the
 * pour joins them wherever the parts are), its unrouted ones are not. A connection to a part with no position yet is
 * left out: it has no length to tell.
 */
function longestLines(design: Design, shown: number): string[] {
  const open = new Set(design.pcb.ratsnest.map(lineKey))
  const poured = new Set(design.pcb.pours.map((pour) => pour.net))
  const unplaced = unplacedParts(design.pcb)
  const placed = (id: string) => !unplaced.has(id.split("#")[0] as string)
  const lines = ratsnest(design.pcb.parts)
    .filter((line) => placed(line.from) && placed(line.to))
    .filter((line) => open.has(lineKey(line)) || !poured.has(line.net))
    .sort((a, b) => lineLength(b) - lineLength(a) || naturalCompare(a.from, b.from))
  if (lines.length === 0) return []
  const pads = padsById(design.pcb)
  const head = `Longest connections, pad to pad (${Math.min(shown, lines.length)} of ${lines.length}):`
  const line = (l: RatsnestLine) => `  ${netLabel(design.circuit.nets, l.net)}: ${connectionPlace(pads, l)} ${mm(lineLength(l))} mm${open.has(lineKey(l)) ? " unrouted" : ""}`
  return [head, ...lines.slice(0, shown).map(line)]
}

function listed(head: string, names: readonly string[], shown: number): string[] {
  if (names.length === 0) return []
  const more = names.length > shown ? `, … and ${names.length - shown} more` : ""
  return [`${head} (${names.length}): ${names.slice(0, shown).join(", ")}${more}`]
}

/** Courtyard overlaps, parts off the board and parts within the edge clearance. */
function findingLines(design: Design, shown: number): string[] {
  const overlaps = design.violations.filter((v) => v.code === "courtyard-overlap").map((v) => v.items.join("/"))
  const outside = design.violations.filter((v) => v.code === "outside-board").flatMap((v) => v.items)
  const outline = design.pcb.board?.outline ?? []
  const edge = design.rules.fabrication.boardEdgeClearance
  const off = new Set(outside)
  const near = outline.length < 3 ? [] : design.pcb.parts.filter((p) => !off.has(p.component) && p.courtyard.length >= 3 && edgeDistance(p.courtyard, outline) < edge - 1e-9).map((p) => p.component).sort(naturalCompare)
  return [...listed("Courtyards overlap", overlaps, shown), ...listed("Off the board", outside, shown), ...listed(`Within the ${edge} mm edge clearance`, near, shown)]
}

function pourLines(design: Design): string[] {
  const byLayer = new Map<string, string[]>()
  for (const pour of design.pcb.pours) byLayer.set(pour.layer, [...(byLayer.get(pour.layer) ?? []), netLabel(design.circuit.nets, pour.net)])
  if (byLayer.size === 0) return ["Pours: none"]
  return [`Pours: ${[...byLayer].map(([layer, nets]) => `${layer} ${nets.join(", ")}`).join("; ")}`]
}

/**
 * The board summary. The default fits about 60 lines: the part lines are cut first and end with "… and N more (detail:
 * full)"; detail "full" lists every part, every unrouted connection and every finding.
 */
export function formatBoardSummary(file: string, design: Design, locked: ReadonlySet<string>, detail: BoardDetail = "compact"): string {
  const full = detail === "full"
  const parts = [...design.pcb.parts].sort((a, b) => naturalCompare(a.component, b.component)).map((p) => partLine(design, p, locked))
  const head = [`${file}: ${sizeLine(design)}`]
  const tail = [
    ...longestLines(design, full ? Infinity : LONGEST_SHOWN),
    ...findingLines(design, full ? Infinity : FINDINGS_SHOWN),
    ...pourLines(design),
    `Unrouted: ${plural(design.pcb.ratsnest.length, "connection")}`,
  ]
  const room = BOARD_SUMMARY_LIMIT - head.length - tail.length
  if (full || parts.length <= room) return [...head, ...parts, ...tail].join("\n")
  const shown = parts.slice(0, Math.max(0, room - 1))
  return [...head, ...shown, `… and ${parts.length - shown.length} more parts (detail: full)`, ...tail].join("\n")
}
