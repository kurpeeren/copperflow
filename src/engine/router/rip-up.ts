import type { RatsnestLine } from "../pcb.js"
import { layoutEdits } from "./cleanup.js"
import { refilled, routedIndex } from "./pour-rounds.js"
import type { RouteBoardInput, RouteBoardOptions, RouteReport, RoutedConnection, UnroutedConnection } from "./route-board.js"

/**
 * Rip-up and retry, after the main run: a connection the run could not route is often closed in by the run's own
 * routes (a pad of a pour's net walled in once the fill was taken to join it). For each such connection, in the
 * report's order: the routes of this run named as blocking it are taken up, the connection is routed first, then the
 * connections the removed routes made are routed again around it. The result is kept only when the board then misses
 * fewer connections than before; otherwise the routes stay as they were.
 *
 * - Only this run's routes are taken up: copper already in the layout (hand-drawn, locked or an earlier run's) is
 *   never touched, since it never carries this run's ids.
 * - The run's scope holds: besides the failed connection (which is in it), only connections the retry itself broke
 *   are routed; a connection the board missed before is never routed by a retry.
 * - A run scoped to a sub-sheet instance is not retried: its routes are copied to the other instances, and taking one
 *   up would leave copies that no longer match it.
 * - The time a retry takes (its refills included) counts against the budget; the retries stop once it is spent.
 * - Deterministic: the same board gives the same tries in the same order.
 */

/** The most failed connections one run retries. */
const MAX_RETRIES = 6
/** The id prefix this run's routes get on the layout the retry asks about, apart from the ids the inner runs give. */
const PRIOR = "prior"

type Router = (input: RouteBoardInput, options: RouteBoardOptions) => RouteReport

const lineKey = (line: { net: string; from: string; to: string }) => `${line.net}|${line.from}|${line.to}`

interface Try {
  routed: RoutedConnection[]
  unrouted: UnroutedConnection[]
  runs: RouteReport[]
}

/** The run's options for a retry's inner runs: the whole board, but never a line the board missed before. */
const inner = (options: RouteBoardOptions, missing: ReadonlySet<string>): RouteBoardOptions => ({ ...options, scope: { kind: "all" }, alreadyMissing: missing })

/** Routes the lines on the layout with `routed` laid as fixed copper, in one pour-aware run of their own. */
function routeOn(input: RouteBoardInput, routed: readonly RoutedConnection[], lines: readonly RatsnestLine[], options: RouteBoardOptions, router: Router): RouteReport {
  const layout = refilled(input, routed, "kept")
  return router({ ...input, layout: { ...layout, ratsnest: [...lines] } }, options)
}

/** One retry of `failed`: undefined when there is nothing to take up. */
function retry(input: RouteBoardInput, report: RouteReport, failed: UnroutedConnection, options: RouteBoardOptions, router: Router): Try | undefined {
  const board = refilled(input, report.routed, PRIOR)
  const line = board.ratsnest.find((one) => lineKey(one) === lineKey(failed))
  if (line === undefined) return undefined
  const before = new Set(board.ratsnest.map(lineKey))
  const others = new Set([...before].filter((key) => key !== lineKey(failed)))
  const asked = inner(options, others)
  const rest = report.unrouted.filter((one) => lineKey(one) !== lineKey(failed))
  // Asked again with this run's routes as layout copper, the router names them by index.
  const probe = router({ ...input, layout: { ...board, ratsnest: [line] } }, asked)
  if (probe.unrouted.length === 0) return { routed: [...report.routed, ...probe.routed], unrouted: rest, runs: [probe] }
  const named = new Set(probe.unrouted.flatMap((one) => one.blockers.flatMap((id) => routedIndex(id, PRIOR) ?? [])))
  if (named.size === 0) return { routed: report.routed, unrouted: report.unrouted, runs: [probe] }
  const kept = report.routed.filter((_, i) => !named.has(i))
  const first = routeOn(input, kept, [line], asked, router)
  if (first.routed.length === 0) return { routed: report.routed, unrouted: report.unrouted, runs: [probe, first] }
  const laid = [...kept, ...first.routed]
  // Only what the retry broke is routed again: the removed routes' connections and fills it cut.
  const again = refilled(input, laid).ratsnest.filter((one) => !before.has(lineKey(one)))
  const second = again.length === 0 ? undefined : routeOn(input, laid, again, asked, router)
  const runs = second === undefined ? [probe, first] : [probe, first, second]
  return { routed: [...laid, ...(second?.routed ?? [])], unrouted: [...rest, ...first.unrouted, ...(second?.unrouted ?? [])], runs }
}

/** The report after rip-up and retry of its failed connections; see the module comment. */
export function ripUpAndRetry(input: RouteBoardInput, report: RouteReport, options: RouteBoardOptions, router: Router): RouteReport {
  const skip = options.retry === false || options.scope?.kind === "instance" || input.layout.board === undefined
  if (skip || report.unrouted.length === 0 || report.budgetSpent) return report
  const clock = options.clock ?? (() => performance.now())
  const spent = (ms: number) => options.budgetMs !== undefined && ms >= options.budgetMs
  let current = report
  for (const failed of report.unrouted.slice(0, MAX_RETRIES)) {
    if (!current.unrouted.some((one) => lineKey(one) === lineKey(failed))) continue
    if (spent(current.ms)) return { ...current, budgetSpent: true }
    const started = clock()
    const budget = options.budgetMs === undefined ? {} : { budgetMs: options.budgetMs - current.ms }
    const tried = retry(input, current, failed, { ...options, ...budget }, router)
    const counted = { ...current, retried: (current.retried ?? 0) + 1 }
    if (tried === undefined) {
      current = { ...counted, ms: counted.ms + (clock() - started) }
      continue
    }
    const runs = tried.runs
    const flags = {
      budgetSpent: runs.some((run) => run.budgetSpent),
      cleanupCapped: current.cleanupCapped || runs.some((run) => run.cleanupCapped),
      cleanupSkipped: current.cleanupSkipped || runs.some((run) => run.cleanupSkipped),
    }
    const better = tried.routed !== current.routed && refilled(input, tried.routed).ratsnest.length < refilled(input, current.routed).ratsnest.length
    const passes = counted.passes + runs.reduce((sum, run) => sum + run.passes, 0)
    const next = better ? { ...counted, ...flags, routed: tried.routed, unrouted: tried.unrouted, passes, edits: layoutEdits(tried.routed) } : { ...counted, budgetSpent: flags.budgetSpent }
    current = { ...next, ms: counted.ms + (clock() - started) }
    if (current.budgetSpent) return current
  }
  return current
}
