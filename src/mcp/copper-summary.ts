import type { Design } from "../engine/design.js"
import type { Violation } from "../engine/index.js"
import { netLabel } from "./copper-under.js"

/** The rule codes of copper findings: the copper checks and what copper joining reports. */
export const COPPER_RULES: ReadonlySet<string> = new Set(["copper-clearance", "track-width", "via-drill", "via-ring", "copper-edge", "copper-keepout", "short", "floating", "mismatch", "copper-layer"])

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

function lengthOf(points: readonly { x: number; y: number }[]): number {
  return points.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - (points[i - 1]?.x ?? p.x), p.y - (points[i - 1]?.y ?? p.y))), 0)
}

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
    one.length += lengthOf(track.points)
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

/** The default copper_summary: totals, a line per net with copper or unrouted connections, then violations by rule; at most 60 lines. */
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
  const tail = violationLine(copperViolations(design))
  const room = Math.max(0, limit - 2)
  if (lines.length <= room) return [head, ...lines, tail].join("\n")
  const shown = lines.slice(0, Math.max(0, room - 1))
  return [head, ...shown, `… and ${lines.length - shown.length} more nets`, tail].join("\n")
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
