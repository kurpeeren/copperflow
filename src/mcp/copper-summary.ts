import { trackLength } from "../engine/copper.js"
import type { Design } from "../engine/design.js"
import type { Violation } from "../engine/index.js"
import type { Hole } from "../engine/model.js"
import { unroutedPlaces } from "../engine/pad-text.js"
import type { PourFill } from "../engine/pcb.js"
import { pourJoins } from "../engine/pour/joins.js"
import { netLabel } from "./copper-under.js"
import { fastLineBlock } from "./fast-summary.js"

export { fastLineBlock }

/** The rule codes of copper findings: the copper checks and what copper joining reports. */
export const COPPER_RULES: ReadonlySet<string> = new Set(["copper-clearance", "track-width", "via-drill", "via-ring", "hole-to-hole", "copper-edge", "copper-keepout", "short", "floating", "mismatch", "copper-layer", "copper-hole", "hole-off-board", "pour-floating", "pour-sparse", "pour-empty", "pour-net", "pair-skew", "pair-apart", "pair-gap", "pair-vias", "net-length", "match-spread", "impedance-width", "drawing-width"])

/** copper_summary stops here, so the answer fits a screen. */
export const SUMMARY_LIMIT = 60
const SHOWN_INTRODUCED = 5

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
const natural = new Intl.Collator("en", { numeric: true })

export const copperViolations = (design: Pick<Design, "violations">): Violation[] => design.violations.filter((v) => COPPER_RULES.has(v.code))

interface NetCopper {
  tracks: number
  vias: number
  length: number
  unrouted: number
}

const mm = (value: number) => value.toFixed(1)

/** Per net id (or "" for copper on no net): tracks, vias, length and the connections still to route. */
function perNet(design: Design): Map<string, NetCopper> {
  const nets = new Map<string, NetCopper>()
  const of = (id: string | undefined) => {
    const key = id ?? ""
    const found = nets.get(key) ?? { tracks: 0, vias: 0, length: 0, unrouted: 0 }
    nets.set(key, found)
    return found
  }
  for (const track of design.pcb.tracks) {
    const one = of(track.net)
    one.tracks += 1
    one.length += trackLength(track.points)
  }
  for (const via of design.pcb.vias) of(via.net).vias += 1
  for (const line of design.pcb.ratsnest) of(line.net).unrouted += 1
  return nets
}

function netLine(name: string, one: NetCopper): string {
  return `${name}: ${plural(one.tracks, "track")}, ${plural(one.vias, "via")}, ${mm(one.length)} mm, ${one.unrouted} unrouted`
}

/** "Copper violations: 3 (copper-clearance 2, via-ring 1)", or "none". */
export function violationLine(violations: readonly Violation[]): string {
  if (violations.length === 0) return "Copper violations: none"
  const counts = new Map<string, number>()
  for (const v of violations) counts.set(v.code, (counts.get(v.code) ?? 0) + 1)
  const listed = [...counts].sort(([a], [b]) => natural.compare(a, b)).map(([code, n]) => `${code} ${n}`)
  return `Copper violations: ${violations.length} (${listed.join(", ")})`
}

const mmText = (n: number) => String(Math.round(n * 1e6) / 1e6)

/** The pads of the pour's net that its fill touches, counted once each: the connections the pour makes. */
function padsJoined(design: Design, fill: PourFill): number {
  const pads = design.pcb.parts.flatMap((part) => part.pads)
  const padIds = new Set(pads.map((pad) => pad.id))
  const touched = pourJoins([fill], pads, design.pcb.tracks, design.pcb.vias).flat()
  return new Set(touched.filter((id) => padIds.has(id))).size
}

/** "copperpour:1 GND bottom: 412.35 mm², joins 7 pads". */
export function pourLine(design: Design, fill: PourFill): string {
  return `${fill.id} ${netLabel(design.circuit.nets, fill.net)} ${fill.layer}: ${fill.area.toFixed(2)} mm², joins ${plural(padsJoined(design, fill), "pad")}`
}

/** "hole:1 at (3, 3), 3.2 mm". */
export const holeLine = (hole: Hole): string => `${hole.id} at (${mmText(hole.x)}, ${mmText(hole.y)}), ${mmText(hole.diameter)} mm`

/** "Pours: 2, holes: 4", then a line per pour and per hole; nothing on a board with neither. */
function boardItemLines(design: Design): string[] {
  const { pours, holes } = design.pcb
  if (pours.length + holes.length === 0) return []
  return [`Pours: ${pours.length}, holes: ${holes.length}`, ...pours.map((fill) => pourLine(design, fill)), ...holes.map(holeLine)]
}

/** The unrouted connections shown with their pad positions; the rest are counted. */
export const UNROUTED_PLACES_SHOWN = 10

/** "Unrouted: C3.pin2 (12.30, 4.50 top) to U2.pin2 (15.10, 6.00 top)", one line per connection, then "… and N more". */
export function unroutedLines(design: Pick<Design, "pcb">, most = UNROUTED_PLACES_SHOWN): string[] {
  const places = unroutedPlaces(design.pcb)
  const shown = places.slice(0, most).map((place) => `Unrouted: ${place}`)
  return places.length > most ? [...shown, `… and ${places.length - most} more unrouted`] : shown
}

/** The drawings on copper, by id, with their layer and size: copper of no net, not counted as tracks. */
export function copperDrawingLines(design: Pick<Design, "pcb">): string[] {
  const drawings = (design.pcb.graphics ?? []).filter((graphic) => ["top", "bottom", "inner1", "inner2"].includes(graphic.layer))
  if (drawings.length === 0) return []
  const line = (g: (typeof drawings)[number]) => `${g.id} ${g.file} ${g.layer} at (${mmText(g.x)}, ${mmText(g.y)}), ${mm(g.width)} x ${mm(g.height)} mm, no net`
  return [`Drawings on copper: ${drawings.map(line).join("; ")}`]
}

/**
 * The default copper_summary: totals, a line per net with copper or unrouted connections, the pours and holes, then
 * violations by rule; at most 60 lines.
 */
export function formatCopperSummary(file: string, design: Design, limit = SUMMARY_LIMIT): string {
  const nets = perNet(design)
  const all = [...nets.values()]
  const [tracks, vias, unrouted] = [design.pcb.tracks.length, design.pcb.vias.length, all.reduce((s, n) => s + n.unrouted, 0)]
  const length = all.reduce((s, n) => s + n.length, 0)
  const head = `${file}: ${plural(tracks, "track")}, ${plural(vias, "via")}, ${mm(length)} mm of copper, ${plural(unrouted, "connection")} unrouted`
  const lines = [...nets]
    .map(([id, one]) => ({ name: id === "" ? "(no net)" : netLabel(design.circuit.nets, id), one }))
    .sort((a, b) => natural.compare(a.name, b.name))
    .map(({ name, one }) => netLine(name, one))
  const items = [...fastLineBlock(design), ...boardItemLines(design), ...copperDrawingLines(design)]
  const tail = violationLine(copperViolations(design))
  const room = Math.max(0, limit - 2 - items.length)
  if (lines.length <= room) {
    const unroutedRoom = Math.min(room - lines.length, UNROUTED_PLACES_SHOWN + 1)
    const places = unroutedLines(design, Math.max(0, unroutedRoom - 1))
    return [head, ...lines, ...(places.length <= unroutedRoom ? places : []), ...items, tail].join("\n")
  }
  const shown = lines.slice(0, Math.max(0, room - 1))
  return [head, ...shown, `… and ${lines.length - shown.length} more nets`, ...items, tail].join("\n")
}

/** The measured value in a violation's message (the first "X mm"; 0 when copper touches); smaller is worse. */
function measured(v: Violation): number | undefined {
  if (v.message.includes("touching or overlapping")) return 0
  const found = /(\d+(?:\.\d+)?) mm/.exec(v.message)
  return found?.[1] === undefined ? undefined : Number(found[1])
}

/** The copper findings of `after` that are new or measure worse than in `before`, as the lines of an answer (at most 5, then "… and N more"). */
export function introducedLines(before: Pick<Design, "violations">, after: Pick<Design, "violations">): string[] {
  const known = new Map(copperViolations(before).map((v) => [v.id, measured(v)]))
  const worse = (v: Violation) => {
    if (!known.has(v.id)) return true
    const [was, now] = [known.get(v.id), measured(v)]
    return was !== undefined && now !== undefined && now < was - 1e-9
  }
  const fresh = copperViolations(after).filter(worse)
  const lines = fresh.slice(0, SHOWN_INTRODUCED).map((v) => `${v.severity} ${v.code} [${v.items.join(", ")}]: ${v.message}`)
  const more = fresh.length - SHOWN_INTRODUCED
  return more > 0 ? [...lines, `… and ${more} more (check_circuit with filter "copper")`] : lines
}
