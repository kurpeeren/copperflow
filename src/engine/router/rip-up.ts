import type { RatsnestLine } from "../pcb.js"
import { layoutEdits } from "./cleanup.js"
import { refilled, routedIndex } from "./pour-rounds.js"
import type { RouteBoardInput, RouteBoardOptions, RouteReport, RoutedConnection, UnroutedConnection } from "./route-board.js"

/**
 * Rip-up and retry, after the main run: a connection the run could not route is often closed in by the run's own
 * routes (a pad of a pour's net walled in once the fill was taken to join it). For each such connection, in the
 * report's order: the routes of this run named as blocking it are taken up, the connection is routed first, then the
 * connections the removed routes made are routed again around it. The result is kept only when the board then misses
 * fewer connections than before; otherwise the routes stay as they were. Only this run's routes are taken up: copper
 * already in the layout (hand-drawn, locked or an earlier run's) is never touched. Deterministic: the same board gives
 * the same tries in the same order.
 */

/** The most failed connections one run retries. */
const MAX_RETRIES = 6

type Router = (input: RouteBoardInput, options: RouteBoardOptions) => RouteReport

const lineKey = (line: { net: string; from: string; to: string }) => `${line.net}|${line.from}|${line.to}`

/** The connections the board still misses once every route is laid and the pours are filled again. */
const missingAfter = (input: RouteBoardInput, routed: readonly RoutedConnection[]) => refilled(input, routed).ratsnest.length

interface Try {
  routed: RoutedConnection[]
  unrouted: UnroutedConnection[]
  passes: number
  ms: number
}

/** Routes the lines on the layout with `routed` laid as fixed copper, in one pour-aware run of their own. */
function routeOn(input: RouteBoardInput, routed: readonly RoutedConnection[], lines: readonly RatsnestLine[], options: RouteBoardOptions, router: Router): RouteReport {
  const layout = refilled(input, routed, "kept")
  return router({ ...input, layout: { ...layout, ratsnest: [...lines] } }, { ...options, scope: { kind: "all" } })
}

/** One retry of `failed`: undefined when there is nothing to take up, or no better board comes of it. */
function retry(input: RouteBoardInput, report: RouteReport, failed: UnroutedConnection, options: RouteBoardOptions, router: Router): Try | undefined {
  const board = refilled(input, report.routed)
  const line = board.ratsnest.find((one) => lineKey(one) === lineKey(failed))
  if (line === undefined) return undefined
  // Asked again with this run's routes as layout copper, the router names them by index.
  const probe = router({ ...input, layout: { ...board, ratsnest: [line] } }, { ...options, scope: { kind: "all" } })
  if (probe.unrouted.length === 0) return { routed: [...report.routed, ...probe.routed], unrouted: report.unrouted.filter((one) => lineKey(one) !== lineKey(failed)), passes: probe.passes, ms: probe.ms }
  const named = new Set(probe.unrouted.flatMap((one) => one.blockers.flatMap((id) => routedIndex(id) ?? [])))
  if (named.size === 0) return undefined
  const kept = report.routed.filter((_, i) => !named.has(i))
  const removed = report.routed.filter((_, i) => named.has(i))
  const first = routeOn(input, kept, [line], options, router)
  if (first.routed.length === 0) return undefined
  const laid = [...kept, ...first.routed]
  const nets = new Set(removed.map((route) => route.net))
  const before = new Set(report.unrouted.map(lineKey))
  const again = refilled(input, laid).ratsnest.filter((one) => nets.has(one.net) && !before.has(lineKey(one)))
  const second = again.length === 0 ? undefined : routeOn(input, laid, again, options, router)
  const routed = [...laid, ...(second?.routed ?? [])]
  const unrouted = [...report.unrouted.filter((one) => lineKey(one) !== lineKey(failed)), ...first.unrouted, ...(second?.unrouted ?? [])]
  return { routed, unrouted, passes: probe.passes + first.passes + (second?.passes ?? 0), ms: probe.ms + first.ms + (second?.ms ?? 0) }
}

/** The report after rip-up and retry of its failed connections; see the module comment. */
export function ripUpAndRetry(input: RouteBoardInput, report: RouteReport, options: RouteBoardOptions, router: Router): RouteReport {
  if (report.unrouted.length === 0 || report.budgetSpent || input.layout.board === undefined) return report
  let current = report
  for (const failed of report.unrouted.slice(0, MAX_RETRIES)) {
    if (options.budgetMs !== undefined && current.ms >= options.budgetMs) break
    if (!current.unrouted.some((one) => lineKey(one) === lineKey(failed))) continue
    const budget = options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs - current.ms }
    const tried = retry(input, current, failed, { ...options, ...budget }, router)
    if (tried === undefined) continue
    const better = missingAfter(input, tried.routed) < missingAfter(input, current.routed)
    current = better
      ? { ...current, routed: tried.routed, unrouted: tried.unrouted, passes: current.passes + tried.passes, edits: layoutEdits(tried.routed), ms: current.ms + tried.ms }
      : { ...current, ms: current.ms + tried.ms }
  }
  return current
}
