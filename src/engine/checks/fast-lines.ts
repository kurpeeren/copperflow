import { netLength, type NetLength } from "../line-length.js"
import type { Net, Point } from "../model.js"
import type { PcbLayout, PcbTrack } from "../pcb.js"
import { netClasses } from "../rules/classes.js"
import { classPairs, hasFastClasses, matchGroups, type NetPair } from "../rules/pairs.js"
import type { NetClass, Rules } from "../rules/schema.js"
import { violation, type Violation } from "./violation.js"

/**
 * The checks of pairs, matched lengths and impedance widths. They are warnings: the router does not route pairs
 * together and does not tune lengths, so these say what to fix by hand. On a board whose classes say nothing of
 * pairs, lengths or impedance, nothing here runs.
 */

/** The share of a pair's length that must run side by side, unless the class sets `minCoupled`. */
export const MIN_COUPLED = 80
const STEP = 0.1
const MAX_SAMPLES = 20000
const GAP_TOLERANCE = 0.025
const WIDTH_TOLERANCE = 0.01

export interface PairFigures {
  pair: NetPair
  a?: NetLength
  b?: NetLength
  /** Of the first net's track length, the share running within twice the gap of the second on the same layer, 0 to 1. */
  coupled: number
  /** The first place the two are not side by side. */
  apartAt?: Point
  /** Where the gap is off the class's value while side by side: how long, the gap seen, and where it starts. */
  gapOff?: { length: number; gap: number; at: Point }
  gap: number
  vias: [number, number]
}

export interface LineFigures {
  /** Every net of a fast class with its length, by net id. */
  lengths: Map<string, NetLength>
  pairs: PairFigures[]
  groups: { name: string; className: string; nets: string[] }[]
  classes: NetClass[]
}

const r1 = (n: number) => n.toFixed(1)
const num = (n: number) => String(Math.round(n * 1000) / 1000)
const isFast = (c: NetClass) => c.pair !== undefined || c.matchGroup !== undefined || c.maxLength !== undefined || c.impedance !== undefined || c.differentialImpedance !== undefined

function nearestOn(p: Point, tracks: readonly PcbTrack[], layer: string): { d: number; width: number } | undefined {
  let best: { d: number; width: number } | undefined
  for (const track of tracks) {
    if (track.layer !== layer) continue
    for (let i = 0; i + 1 < track.points.length; i += 1) {
      const [a, b] = [track.points[i] as Point, track.points[i + 1] as Point]
      const [dx, dy] = [b.x - a.x, b.y - a.y]
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
      const d = Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
      if (!best || d < best.d) best = { d, width: track.width }
    }
  }
  return best
}

function coupling(aTracks: readonly PcbTrack[], bTracks: readonly PcbTrack[], gap: number): Pick<PairFigures, "coupled" | "apartAt" | "gapOff"> {
  const total = aTracks.reduce((s, t) => s + t.points.slice(1).reduce((u, p, i) => u + Math.hypot(p.x - (t.points[i] as Point).x, p.y - (t.points[i] as Point).y), 0), 0)
  const step = Math.max(STEP, total / MAX_SAMPLES)
  let [coupled, offLength, sampled] = [0, 0, 0]
  let apartAt: Point | undefined
  let off: { gap: number; at: Point } | undefined
  for (const track of aTracks) {
    for (let i = 0; i + 1 < track.points.length; i += 1) {
      const [a, b] = [track.points[i] as Point, track.points[i + 1] as Point]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const n = Math.max(1, Math.round(len / step))
      for (let k = 0; k < n; k += 1) {
        const p = { x: a.x + ((k + 0.5) / n) * (b.x - a.x), y: a.y + ((k + 0.5) / n) * (b.y - a.y) }
        const piece = len / n
        sampled += piece
        const near = nearestOn(p, bTracks, track.layer)
        const edge = near ? near.d - (track.width + near.width) / 2 : Infinity
        if (edge > 2 * gap + GAP_TOLERANCE) {
          apartAt ??= p
          continue
        }
        coupled += piece
        if (Math.abs(edge - gap) <= GAP_TOLERANCE) continue
        offLength += piece
        off ??= { gap: edge, at: k === 0 ? a : p }
      }
    }
  }
  const share = sampled > 0 ? coupled / sampled : 0
  return { coupled: share, ...(apartAt ? { apartAt } : {}), ...(off ? { gapOff: { length: offLength, gap: off.gap, at: off.at } } : {}) }
}

/** The lengths, pairs and groups of the fast classes; undefined on a board whose classes have none. */
export function measureLines(nets: readonly Net[], layout: Pick<PcbLayout, "parts" | "tracks" | "vias">, rules: Rules, boardThickness: number): LineFigures | undefined {
  if (!hasFastClasses(rules)) return undefined
  const byNet = netClasses(rules, nets).byNet
  const fast = new Set(rules.classes.filter(isFast).map((c) => c.name))
  const lengths = new Map<string, NetLength>()
  for (const net of nets) {
    if (!fast.has(byNet.get(net.id) ?? "")) continue
    const found = netLength(net.id, layout, boardThickness)
    if (found) lengths.set(net.id, found)
  }
  const classOf = (name: string) => rules.classes.find((c) => c.name === name) as NetClass
  const pairs = classPairs(rules, nets, byNet).pairs.map((pair): PairFigures => {
    const gap = classOf(pair.className).gap ?? classOf(pair.className).clearance
    const on = (net: string) => layout.tracks.filter((t) => t.net === net && t.points.length >= 2)
    const viaCount = (net: string) => layout.vias.filter((v) => v.net === net).length
    const a = lengths.get(pair.a)
    const b = lengths.get(pair.b)
    return { pair, ...(a ? { a } : {}), ...(b ? { b } : {}), ...coupling(on(pair.a), on(pair.b), gap), gap, vias: [viaCount(pair.a), viaCount(pair.b)] }
  })
  return { lengths, pairs, groups: matchGroups(rules, nets, byNet), classes: rules.classes.filter(isFast) }
}

const label = (nets: readonly Net[], id: string) => nets.find((n) => n.id === id)?.names[0] ?? id.replace(/^net\./, "")

function padAt(layout: Pick<PcbLayout, "parts">, id: string): Point | undefined {
  const pad = layout.parts.flatMap((p) => p.pads).find((one) => one.id === id)
  return pad ? { x: pad.x, y: pad.y } : undefined
}

function pairChecks(figures: PairFigures, nets: readonly Net[], layout: PcbLayout, rules: Rules, unrouted: ReadonlySet<string>): Violation[] {
  const { pair, a, b } = figures
  if (unrouted.has(pair.a) || unrouted.has(pair.b) || !a || !b) return []
  const netClass = rules.classes.find((c) => c.name === pair.className) as NetClass
  const [na, nb] = [label(nets, pair.a), label(nets, pair.b)]
  const items = [pair.a, pair.b]
  const found: Violation[] = []
  const name = `Pair ${na} and ${nb}`
  const skew = Math.abs(a.length - b.length)
  if (netClass.maxSkew !== undefined && skew > netClass.maxSkew + 1e-6) {
    const longer = a.length >= b.length ? a : b
    const message = `${name}: ${na} is ${r1(a.length)} mm, ${nb} is ${r1(b.length)} mm, ${r1(skew)} mm apart; maxSkew is ${num(netClass.maxSkew)} mm`
    found.push(violation("pair-skew", "warning", message, items, "pcb", padAt(layout, longer.from)))
  }
  const minimum = netClass.minCoupled ?? MIN_COUPLED
  if (figures.coupled * 100 < minimum - 1e-9) {
    const message = `${name} runs side by side for ${Math.round(figures.coupled * 100)} % of its length (within twice its ${num(figures.gap)} mm gap on one layer); the class's minCoupled is ${minimum} %`
    found.push(violation("pair-apart", "warning", message, items, "pcb", figures.apartAt))
  } else if (figures.gapOff) {
    const { length, gap, at } = figures.gapOff
    const message = `${name}: the gap is ${num(gap)} mm instead of ${num(figures.gap)} mm for ${r1(length)} mm, from (${num(at.x)}, ${num(at.y)})`
    found.push(violation("pair-gap", "warning", message, items, "pcb", at))
  }
  if (figures.vias[0] !== figures.vias[1]) {
    const message = `${name}: ${na} has ${figures.vias[0]} via${figures.vias[0] === 1 ? "" : "s"}, ${nb} has ${figures.vias[1]}`
    found.push(violation("pair-vias", "warning", message, items, "pcb", padAt(layout, a.from)))
  }
  return found
}

function lengthChecks(lines: LineFigures, nets: readonly Net[], layout: PcbLayout, rules: Rules, byNet: ReadonlyMap<string, string>, unrouted: ReadonlySet<string>): Violation[] {
  return [...lines.lengths].flatMap(([net, found]) => {
    const max = rules.classes.find((c) => c.name === byNet.get(net))?.maxLength
    if (max === undefined || unrouted.has(net) || found.length <= max + 1e-6) return []
    const message = `${label(nets, net)} is ${r1(found.length)} mm long between ${found.from} and ${found.to}; maxLength is ${num(max)} mm`
    return [violation("net-length", "warning", message, [net], "pcb", padAt(layout, found.from))]
  })
}

function groupChecks(lines: LineFigures, nets: readonly Net[], layout: PcbLayout, rules: Rules, unrouted: ReadonlySet<string>): Violation[] {
  return lines.groups.flatMap((group) => {
    const max = rules.classes.find((c) => c.name === group.className)?.maxSpread
    const measured = group.nets.flatMap((net) => {
      const found = lines.lengths.get(net)
      return found && !unrouted.has(net) ? [{ net, found }] : []
    })
    if (max === undefined || measured.length < 2 || measured.length < group.nets.length) return []
    const sorted = [...measured].sort((x, y) => x.found.length - y.found.length)
    const [shortest, longest] = [sorted[0], sorted.at(-1)] as [(typeof sorted)[number], (typeof sorted)[number]]
    const spread = longest.found.length - shortest.found.length
    if (spread <= max + 1e-6) return []
    const each = measured.map((m) => `${label(nets, m.net)} ${r1(m.found.length)} mm`).join(", ")
    const message = `Match group ${group.name} spreads ${r1(spread)} mm, over its maxSpread of ${num(max)} mm: ${each}; longest ${label(nets, longest.net)}, shortest ${label(nets, shortest.net)}`
    return [violation("match-spread", "warning", message, group.nets, "pcb", padAt(layout, longest.found.from))]
  })
}

/** A track of an impedance class wider than its class (a narrower one is already a track-width error). */
function widthChecks(layout: PcbLayout, rules: Rules, byNet: ReadonlyMap<string, string>): Violation[] {
  return layout.tracks.flatMap((track) => {
    const netClass = rules.classes.find((c) => c.name === byNet.get(track.net ?? ""))
    if (!netClass || (netClass.impedance === undefined && netClass.differentialImpedance === undefined && netClass.pair === undefined)) return []
    if (track.width <= netClass.trackWidth + WIDTH_TOLERANCE) return []
    const message = `${track.id} is ${num(track.width)} mm wide; the class ${netClass.name} routes at ${num(netClass.trackWidth)} mm`
    return [violation("impedance-width", "warning", message, [track.id], "pcb", track.points[0])]
  })
}

/** Every pair, length and impedance-width finding; none on a board without such classes. */
export function fastLineChecks(nets: readonly Net[], layout: PcbLayout, rules: Rules, boardThickness: number): Violation[] {
  const lines = measureLines(nets, layout, rules, boardThickness)
  if (!lines) return []
  const byNet = netClasses(rules, nets).byNet
  const unrouted = new Set(layout.ratsnest.map((line) => line.net))
  return [
    ...lines.pairs.flatMap((figures) => pairChecks(figures, nets, layout, rules, unrouted)),
    ...lengthChecks(lines, nets, layout, rules, byNet, unrouted),
    ...groupChecks(lines, nets, layout, rules, unrouted),
    ...widthChecks(layout, rules, byNet),
  ]
}

/** A net's length as the Studio's nets list shows it; plain JSON. */
export interface LineRow {
  net: string
  length: number
  from: string
  to: string
  vias: number
  /** The other net of its pair, and the two lengths' difference. */
  partner?: string
  skew?: number
}

/** The rows of every measured net of a fast class, in net order; undefined on a board without such classes. */
export function lineRows(nets: readonly Net[], layout: Pick<PcbLayout, "parts" | "tracks" | "vias">, rules: Rules, boardThickness: number): LineRow[] | undefined {
  const lines = measureLines(nets, layout, rules, boardThickness)
  if (!lines) return undefined
  const partners = new Map<string, string>()
  for (const { pair } of lines.pairs) {
    partners.set(pair.a, pair.b)
    partners.set(pair.b, pair.a)
  }
  return nets.flatMap((net) => {
    const found = lines.lengths.get(net.id)
    if (!found) return []
    const partner = partners.get(net.id)
    const other = partner === undefined ? undefined : lines.lengths.get(partner)
    const row: LineRow = { net: net.id, length: found.length, from: found.from, to: found.to, vias: found.vias }
    if (partner !== undefined) row.partner = partner
    if (other) row.skew = Math.abs(found.length - other.length)
    return [row]
  })
}

/** The thickness a via adds: the board's own, else the profile's, else 1.6 mm. */
export const viaThickness = (boardThickness: number | undefined, rules: Rules): number => boardThickness ?? rules.fabrication.boardThickness ?? 1.6
