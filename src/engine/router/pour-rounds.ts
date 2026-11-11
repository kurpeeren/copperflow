import type { LayoutRecord } from "../../core/layout-file.js"
import type { PcbTrack, PcbVia } from "../copper.js"
import type { PcbLayout, RatsnestLine } from "../pcb.js"
import { cachedPourFills } from "../pour/cache.js"
import { resolveWithPours, type PourFiller } from "../pour/resolve.js"
import { ratsnest } from "../ratsnest.js"
import { layoutEdits } from "./cleanup.js"
import { classLookup, padName, type RouteInput } from "./connect.js"
import type { RouteBoardInput, RouteBoardOptions, RouteReport, RoutedConnection } from "./route-board.js"

/**
 * Routing a board with pours. The router treats a pour as free space: its fill is not an obstacle, and the connections
 * the fill already makes are not in the ratsnest, so they are not routed. Once the routes are laid the fill is computed
 * again around them (as the next build would), and it may now be cut apart by other nets' tracks: the connections of a
 * pour's net that the new fill no longer makes are routed in another round, with the routes laid so far as fixed copper.
 * Rounds repeat until the fill makes every connection of its net that is not routed, a round routes nothing, the cap
 * or the budget; what is still missing then is reported unrouted, so a run never hides an airwire the next build shows.
 */

/** The most extra rounds after the first; one usually settles it, since a pour net's own tracks never cut its fill. */
const MAX_ROUNDS = 3

const trackRecord = (track: PcbTrack): LayoutRecord => ({
  t: "track",
  id: track.id,
  ...(track.named === undefined ? {} : { net: track.named }),
  layer: track.layer,
  width: track.width,
  points: track.points,
  locked: track.locked,
  by: track.by,
})

const viaRecord = (via: PcbVia): LayoutRecord => ({
  t: "via",
  id: via.id,
  ...(via.named === undefined ? {} : { net: via.named }),
  at: via.at,
  drill: via.drill,
  diameter: via.diameter,
  layers: via.layers,
  locked: via.locked,
  by: via.by,
})

/** The routes as layout records of their nets, with ids no layout file uses: `routed:3:t1` is the first track of the third route. */
function routedRecords(routed: readonly RoutedConnection[], prefix: string): LayoutRecord[] {
  return routed.flatMap((route, i) => [
    ...route.copper.tracks.map((track, j): LayoutRecord => ({ t: "track", id: `${prefix}:${i + 1}:t${j + 1}`, net: route.net, ...track, locked: false, by: "router" })),
    ...route.copper.vias.map((via, j): LayoutRecord => ({ t: "via", id: `${prefix}:${i + 1}:v${j + 1}`, net: route.net, ...via, locked: false, by: "router" })),
  ])
}

/** The route a `<prefix>:N:…` copper id names (`routed:N:…` by default), as an index into the routes it was made from. */
export function routedIndex(id: string, prefix = "routed"): number | undefined {
  if (!id.startsWith(`${prefix}:`)) return undefined
  const found = /^(\d+):[tv]\d+$/.exec(id.slice(prefix.length + 1))
  return found ? Number(found[1]) - 1 : undefined
}

/**
 * The layout with the routes added as copper, the pours filled again around it, and the ratsnest of what is left.
 * The routes' copper ids start with `prefix` (`routed` by default), so a layout refilled twice keeps them apart.
 */
export function refilled(input: RouteInput, routed: readonly RoutedConnection[], prefix = "routed"): PcbLayout {
  const { layout, rules, nets } = input
  const board = layout.board
  if (board === undefined) return layout
  const records = [...layout.tracks.map(trackRecord), ...layout.vias.map(viaRecord), ...routedRecords(routed, prefix)]
  const classOf = classLookup(rules, nets)
  const fill: PourFiller = (pads, copper) => cachedPourFills({ board, pads, tracks: copper.tracks, vias: copper.vias, rules, classOf })
  const { copper, pours } = resolveWithPours(layout.parts, records, nets, board.layers, fill)
  return { ...layout, tracks: copper.tracks, vias: copper.vias, pours, ratsnest: ratsnest(layout.parts, copper.islands) }
}

const lineKey = (line: { net: string; from: string; to: string }) => `${line.net}|${line.from}|${line.to}`

/** The two rounds as one report: the later round's results replace the earlier failures of the lines it took on again. */
function merged(before: RouteReport, after: RouteReport, retried: ReadonlySet<string>): RouteReport {
  const routed = [...before.routed, ...after.routed]
  const unrouted = [...before.unrouted.filter((one) => !retried.has(lineKey(one))), ...after.unrouted]
  return {
    ...before,
    routed,
    unrouted,
    passes: before.passes + after.passes,
    edits: layoutEdits(routed),
    ms: before.ms + after.ms,
    cleanupCapped: before.cleanupCapped || after.cleanupCapped,
    cleanupSkipped: before.cleanupSkipped || after.cleanupSkipped,
    budgetSpent: before.budgetSpent || after.budgetSpent,
  }
}

/** The report with the lines the refilled pours no longer join, and that no round reported, added as unrouted. */
function withLeftover(report: RouteReport, layout: PcbLayout, missing: readonly RatsnestLine[]): RouteReport {
  const pads = new Map(layout.parts.flatMap((part) => part.pads).map((pad) => [pad.id, pad]))
  const name = (id: string) => {
    const pad = pads.get(id)
    return pad === undefined ? id : padName(pad)
  }
  const reported = new Set(report.unrouted.map(lineKey))
  const left = missing
    .filter((line) => !reported.has(lineKey(line)))
    .map((line) => ({ net: line.net, from: line.from, to: line.to, reason: `the refilled pour no longer joins ${name(line.from)} to ${name(line.to)}`, blockers: [] }))
  return left.length === 0 ? report : { ...report, unrouted: [...report.unrouted, ...left] }
}

/**
 * Routes the board with `routeOnce`, then routes again what the refilled pours no longer join; see the module comment.
 * The extra rounds take exactly those lines, whatever the run's scope: the run's own copper broke them. A line in
 * `alreadyMissing` was open before the run (a scoped run passes the board's open lines) and is left alone. Lines still
 * missing when the rounds stop (a round routed nothing, the cap, the budget) are reported unrouted.
 */
export function routeWithPours(input: RouteBoardInput, options: RouteBoardOptions, routeOnce: (input: RouteBoardInput, options: RouteBoardOptions) => RouteReport): RouteReport {
  let report = routeOnce(input, options)
  if ((input.layout.board?.pours ?? []).length === 0) return report
  for (let round = 0; ; round++) {
    const layout = refilled(input, report.routed)
    const pourNets = new Set(layout.pours.map((pour) => pour.net))
    const reported = new Set([...report.unrouted.map(lineKey), ...(options.alreadyMissing ?? [])])
    const missing = layout.ratsnest.filter((line) => pourNets.has(line.net) && !reported.has(lineKey(line)))
    if (missing.length === 0) return report
    // The rounds' own time is what the budget counts: refilling between them is quick, and the clock is read only by the runs.
    const spent = options.budgetMs !== undefined && report.ms >= options.budgetMs
    if (round >= MAX_ROUNDS || report.budgetSpent || spent) return withLeftover(report, layout, missing)
    const budget = options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs - report.ms }
    const next = routeOnce({ ...input, layout: { ...layout, ratsnest: missing } }, { ...options, ...budget, scope: { kind: "all" } })
    report = merged(report, next, new Set(missing.map(lineKey)))
    if (next.routed.length === 0) return withLeftover(report, layout, missing)
  }
}
