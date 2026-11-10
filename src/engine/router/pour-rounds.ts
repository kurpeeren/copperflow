import type { LayoutRecord } from "../../core/layout-file.js"
import type { PcbTrack, PcbVia } from "../copper.js"
import type { PcbLayout } from "../pcb.js"
import { cachedPourFills } from "../pour/cache.js"
import { resolveWithPours, type PourFiller } from "../pour/resolve.js"
import { ratsnest } from "../ratsnest.js"
import { layoutEdits } from "./cleanup.js"
import { classLookup, type RouteInput } from "./connect.js"
import type { RouteBoardInput, RouteBoardOptions, RouteReport, RoutedConnection } from "./route-board.js"

/**
 * Routing a board with pours. The router treats a pour as free space: its fill is not an obstacle, and the connections
 * the fill already makes are not in the ratsnest, so they are not routed. Once the routes are laid the fill is computed
 * again around them (as the next build would), and it may now be cut apart by other nets' tracks: the connections of a
 * pour's net that the new fill no longer makes are routed in another round, with the routes laid so far as fixed copper.
 * Rounds repeat until the fill makes every connection of its net that is not routed, a round routes nothing, or the cap.
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

/** The routes as layout records of their nets, with ids no layout file uses. */
function routedRecords(routed: readonly RoutedConnection[]): LayoutRecord[] {
  return routed.flatMap((route, i) => [
    ...route.copper.tracks.map((track, j): LayoutRecord => ({ t: "track", id: `routed:${i + 1}:t${j + 1}`, net: route.net, ...track, locked: false, by: "router" })),
    ...route.copper.vias.map((via, j): LayoutRecord => ({ t: "via", id: `routed:${i + 1}:v${j + 1}`, net: route.net, ...via, locked: false, by: "router" })),
  ])
}

/** The layout with the routes added as copper, the pours filled again around it, and the ratsnest of what is left. */
export function refilled(input: RouteInput, routed: readonly RoutedConnection[]): PcbLayout {
  const { layout, rules, nets } = input
  const board = layout.board
  if (board === undefined) return layout
  const records = [...layout.tracks.map(trackRecord), ...layout.vias.map(viaRecord), ...routedRecords(routed)]
  const classOf = classLookup(rules, nets)
  const fill: PourFiller = (pads, copper) => cachedPourFills({ board, pads, tracks: copper.tracks, vias: copper.vias, rules, classOf })
  const { copper, pours } = resolveWithPours(layout.parts, records, nets, board.layers, fill)
  return { ...layout, tracks: copper.tracks, vias: copper.vias, pours, ratsnest: ratsnest(layout.parts, copper.islands) }
}

const lineKey = (line: { net: string; from: string; to: string }) => `${line.net}|${line.from}|${line.to}`

/** The two rounds as one report: the later round's results replace the earlier failures of the nets it took on again. */
function merged(before: RouteReport, after: RouteReport, retried: ReadonlySet<string>, ms: number): RouteReport {
  const routed = [...before.routed, ...after.routed]
  const unrouted = [...before.unrouted.filter((one) => !retried.has(one.net)), ...after.unrouted]
  return {
    ...before,
    routed,
    unrouted,
    passes: before.passes + after.passes,
    edits: layoutEdits(routed),
    ms,
    cleanupCapped: before.cleanupCapped || after.cleanupCapped,
    cleanupSkipped: before.cleanupSkipped || after.cleanupSkipped,
    budgetSpent: before.budgetSpent || after.budgetSpent,
  }
}

/** Routes the board with `routeOnce`, then routes again what the refilled pours no longer join; see the module comment. */
export function routeWithPours(input: RouteBoardInput, options: RouteBoardOptions, routeOnce: (input: RouteBoardInput, options: RouteBoardOptions) => RouteReport): RouteReport {
  let report = routeOnce(input, options)
  if ((input.layout.board?.pours ?? []).length === 0) return report
  const tried = new Set<string>()
  for (let round = 0; round < MAX_ROUNDS && !report.budgetSpent; round++) {
    const layout = refilled(input, report.routed)
    const pourNets = new Set(layout.pours.map((pour) => pour.net))
    const missing = layout.ratsnest.filter((line) => pourNets.has(line.net) && !tried.has(lineKey(line)))
    if (missing.length === 0) break
    // The rounds' own time is what the budget counts: refilling between them is quick, and the clock is read only by the runs.
    const spent = report.ms
    if (options.budgetMs !== undefined && spent >= options.budgetMs) break
    const budget = options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs - spent }
    const next = routeOnce({ ...input, layout: { ...layout, ratsnest: missing } }, { ...options, ...budget })
    for (const line of missing) tried.add(lineKey(line))
    report = merged(report, next, new Set(missing.map((line) => line.net)), report.ms + next.ms)
    if (next.routed.length === 0) break
  }
  return report
}
