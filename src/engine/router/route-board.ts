import type { LayoutEdit } from "../../core/layout-records.js"
import type { Component, SheetInstance } from "../model.js"
import { cleanupReport, layoutEdits } from "./cleanup.js"
import { naturalCompare } from "../order.js"
import type { RatsnestLine, WorldPad } from "../pcb.js"
import { SearchBuffers } from "./astar.js"
import { Congestion, clearOf, near, placeRoute, type Occupancy, type Placed } from "./congestion.js"
import { attempt, cannot, classLookup, netRule, type Job, type RouteInput } from "./connect.js"
import { islandsOf } from "./ends.js"
import { routerWorld, type CellWindow, type NetRule, type RouterWorld } from "./grid.js"
import type { Obstacle } from "./obstacles.js"
import { routeWithPours } from "./pour-rounds.js"
import type { RoutedCopper } from "./path.js"
import { replicate, type Replica } from "./replicate.js"
import { ripUpAndRetry } from "./rip-up.js"

/**
 * The whole job: the connections the ratsnest still misses (all of them, or those of some nets, of some parts, or
 * inside one sub-sheet instance), routed shortest first and negotiated until no two nets want the same room, or the
 * pass cap is reached. Then what is still contested is settled in the same order: each route clear of the routes kept
 * before it stays, the others are routed once more around those as walls, and what cannot be is reported with the
 * pins and the objects in the way. An instance's routes are then copied to the other instances of its sheet whose
 * placement matches. Last, every route is cleaned up (see cleanup) and given as layout edits too.
 */

export type RouteScope =
  | { kind: "all" }
  | { kind: "nets"; nets: readonly string[] }
  | { kind: "parts"; parts: readonly string[] }
  | { kind: "instance"; instance: string }

export interface RouteBoardInput extends RouteInput {
  components?: readonly Component[]
  instances?: readonly SheetInstance[]
}

/** How far a run is: a negotiation pass's connections done of its total, or the cleanup, which says whether it hit its pass cap. */
export type RouteProgress = { stage: "routing"; pass: number; done: number; total: number } | { stage: "cleanup"; capped: boolean; skipped?: boolean }

export interface RouteBoardOptions {
  scope?: RouteScope
  /** Told after each connection a pass routes, and once the cleanup ends. */
  onProgress?: (progress: RouteProgress) => void
  /** The most negotiation passes; 30 by default. */
  maxPasses?: number
  /** The most states one search takes before it gives up (the search's own bound by default). */
  maxExpansions?: number
  /**
   * The time the run may take, in ms: once spent, no connection is started, routed again or copied to another instance,
   * those not routed are reported, and the routes made so far are kept whole; the cleanup is skipped when the budget is
   * spent before it starts (the routes are clear, maybe not at their shortest). No limit by default.
   */
  budgetMs?: number
  /** The clock the budget is measured on, in ms (performance.now by default); tests pass their own. */
  clock?: () => number
}

export interface RoutedConnection {
  net: string
  from: string
  to: string
  copper: RoutedCopper
  /** What the search paid for the route (moves, corners, vias and congestion); absent on a copy. */
  cost?: number
  /** For a copy made by replication: the instance the route was copied from. */
  copiedFrom?: string
}

export interface UnroutedConnection {
  net: string
  from: string
  to: string
  reason: string
  blockers: string[]
}

export interface RouteReport {
  routed: RoutedConnection[]
  unrouted: UnroutedConnection[]
  /** The negotiation passes run. */
  passes: number
  /** The routed copper, cleaned up, as layout edits in one list (see cleanup). */
  edits: LayoutEdit[]
  ms: number
  /** Whether cleanup stopped at its pass cap before the routes settled (they are still clear, maybe not at their shortest). */
  cleanupCapped: boolean
  /** Whether the cleanup was skipped because the time budget was spent before it started. */
  cleanupSkipped: boolean
  /** With the instance scope: what became of each other instance of the sheet. */
  replicas?: Replica[]
  /** Whether the run stopped at its time budget, leaving connections it had not routed. */
  budgetSpent: boolean
}

/** The reason given to a connection the time budget left unrouted, after "could not route A to B: ". */
export const OUT_OF_TIME = "the time budget ran out before it was routed"

export const MAX_PASSES = 30

interface Connection {
  index: number
  line: RatsnestLine
  job: Job
}

const withNet = (net: string) => (net.startsWith("net.") || net.startsWith("net:") ? net : `net.${net}`)
const componentOf = (padId: string) => padId.split("#")[0] ?? padId

/** The instance a scope names, by name or path. */
export function findInstance(instances: readonly SheetInstance[] | undefined, name: string): SheetInstance | undefined {
  return instances?.find((instance) => instance.name === name || instance.path === name)
}

/** The ratsnest lines the scope covers. */
function linesIn(input: RouteBoardInput, scope: RouteScope): RatsnestLine[] {
  const lines = input.layout.ratsnest
  switch (scope.kind) {
    case "all":
      return [...lines]
    case "nets": {
      const nets = new Set(scope.nets.flatMap((net) => [net, withNet(net)]))
      return lines.filter((line) => nets.has(line.net))
    }
    case "parts": {
      const parts = new Set(scope.parts)
      return lines.filter((line) => parts.has(componentOf(line.from)) || parts.has(componentOf(line.to)))
    }
    case "instance": {
      const parts = new Set(findInstance(input.instances, scope.instance)?.parts ?? [])
      return lines.filter((line) => parts.has(componentOf(line.from)) && parts.has(componentOf(line.to)))
    }
  }
}

const lengthOf = (line: RatsnestLine) => Math.hypot(line.a.x - line.b.x, line.a.y - line.b.y)

/** Shortest first; ties by net name, then the pins. */
const byLength = (a: RatsnestLine, b: RatsnestLine) => lengthOf(a) - lengthOf(b) || naturalCompare(a.net, b.net) || naturalCompare(a.from, b.from) || naturalCompare(a.to, b.to)

/** The jobs for the lines: each with its net's rule and the islands of copper its two pads are in. */
function connectionsOf(world: RouterWorld, input: RouteBoardInput, lines: readonly RatsnestLine[]): Connection[] {
  const pads = new Map(input.layout.parts.flatMap((part) => part.pads).map((pad) => [pad.id, pad]))
  const rules = new Map<string, NetRule>()
  const islands = new Map<string, Map<string, Obstacle[]>>()
  const islandOf = (net: string, padId: string): Obstacle[] => {
    let byPad = islands.get(net)
    if (byPad === undefined) {
      byPad = new Map()
      for (const island of islandsOf(input.layout, world.obstacles.filter((piece) => piece.net === net))) for (const piece of island) byPad.set(piece.id, island)
      islands.set(net, byPad)
    }
    return byPad.get(padId) ?? []
  }
  const ruleOf = (net: string) => rules.get(net) ?? rules.set(net, netRule(input.rules, input.nets, net)).get(net)!
  return [...lines].sort(byLength).flatMap((line, index) => {
    const [from, to] = [pads.get(line.from), pads.get(line.to)] as [WorldPad | undefined, WorldPad | undefined]
    if (from === undefined || to === undefined) return []
    return [{ index, line, job: { rule: ruleOf(line.net), from, to, start: islandOf(line.net, from.id), end: islandOf(line.net, to.id) } }]
  })
}

interface Run {
  maxExpansions?: number
  world: RouterWorld
  congestion: Congestion
  buffers: SearchBuffers
  failed: Map<number, UnroutedConnection>
  onProgress?: (progress: RouteProgress) => void
  /** Whether the time budget is spent; it stays spent once it is. */
  late: () => boolean
}

const unrouted = (connection: Connection, reason: string, blockers: string[]): UnroutedConnection => ({ net: connection.line.net, from: connection.line.from, to: connection.line.to, reason, blockers })
const outOfTime = (connection: Connection) => unrouted(connection, `${cannot(connection.job.from, connection.job.to)}: ${OUT_OF_TIME}`, [])

/** The budget's test: false until the clock passes the deadline, then true from then on. */
function lateness(clock: () => number, started: number, budgetMs: number | undefined): () => boolean {
  if (budgetMs === undefined) return () => false
  let spent = false
  return () => (spent ||= clock() - started >= budgetMs)
}

/** Routes one connection in pass `pass` against the others' copper as a cost; returns the routes it is in conflict with. */
function negotiate(run: Run, connection: Connection, pass: number): Set<number> | undefined {
  const { world, congestion } = run
  const before = congestion.placed.get(connection.index)
  congestion.placed.delete(connection.index)
  const occupancies = new Map<CellWindow, Occupancy>()
  const result = attempt(world, connection.job, {
    extra: congestion.holes(),
    buffers: run.buffers,
    ...(run.maxExpansions === undefined ? {} : { maxExpansions: run.maxExpansions }),
    penalties: (grid, window) => {
      const occupancy = congestion.costs(connection.job.rule, grid, window, pass)
      occupancies.set(window, occupancy)
      return occupancy.penalties
    },
  })
  if (!result.routed) {
    if (result.limit === true && before !== undefined) {
      congestion.placed.set(connection.index, before)
      return new Set()
    }
    run.failed.set(connection.index, unrouted(connection, result.reason, result.blockers))
    return undefined
  }
  const placed = placeRoute(world, connection.index, result.copper, connection.job.rule.className, result.steps, result.grid, result.window, legsOf(result.copper, connection.job), result.cost)
  congestion.placed.set(connection.index, placed)
  const occupancy = occupancies.get(result.window)
  return occupancy === undefined ? new Set() : congestion.conflicts(world, connection.job.rule, placed, occupancy, result.grid, result.window)
}

/** Where the route leaves its pads' centres off the grid (a leg), as the copper shows it. */
function legsOf(copper: RoutedCopper, job: Job) {
  const [first, last] = [copper.tracks[0]?.points[0], copper.tracks.at(-1)?.points.at(-1)]
  const at = (pad: WorldPad, p: { x: number; y: number } | undefined) => p !== undefined && p.x === pad.x && p.y === pad.y
  return { ...(at(job.from, first) ? { start: first } : {}), ...(at(job.to, last) ? { end: last } : {}) }
}

/** Negotiation passes until one passes without conflict, or the cap. Returns the passes run. */
function negotiateAll(run: Run, connections: readonly Connection[], maxPasses: number): number {
  let pending = [...connections]
  for (let pass = 1; pass <= maxPasses; pass++) {
    const fought = new Set<number>()
    for (const [done, connection] of pending.entries()) {
      if (run.late()) return pass
      const others = negotiate(run, connection, pass)
      run.onProgress?.({ stage: "routing", pass, done: done + 1, total: pending.length })
      if (others === undefined || others.size === 0) continue
      fought.add(connection.index)
      for (const other of others) fought.add(other)
    }
    if (fought.size === 0) return pass
    pending = connections.filter((connection) => fought.has(connection.index) && !run.failed.has(connection.index))
    if (pass === maxPasses) return pass
  }
  return 0
}

/** Keeps each route clear of those kept before it; routes the rest once more around the kept ones as walls. */
function settle(run: Run, connections: readonly Connection[]): void {
  const { world, congestion } = run
  const kept: Placed[] = []
  for (const connection of connections) {
    const placed = congestion.placed.get(connection.index)
    if (placed === undefined) {
      // Only the budget leaves a connection neither placed nor failed: it was never tried.
      if (!run.failed.has(connection.index)) run.failed.set(connection.index, outOfTime(connection))
      continue
    }
    const rule = connection.job.rule
    if (clearOf(world, rule, placed, kept.filter((other) => other.net !== placed.net && near(world, rule, placed.box, other.box)))) {
      kept.push(placed)
      continue
    }
    congestion.placed.delete(connection.index)
    if (run.late()) {
      run.failed.set(connection.index, outOfTime(connection))
      continue
    }
    const walls = [...kept.flatMap((other) => other.pieces), ...congestion.holes()]
    const result = attempt(world, connection.job, { extra: walls, buffers: run.buffers, ...(run.maxExpansions === undefined ? {} : { maxExpansions: run.maxExpansions }) })
    if (!result.routed) {
      run.failed.set(connection.index, unrouted(connection, result.reason, result.blockers))
      continue
    }
    const again = placeRoute(world, connection.index, result.copper, rule.className, result.steps, result.grid, result.window, legsOf(result.copper, connection.job), result.cost)
    congestion.placed.set(connection.index, again)
    kept.push(again)
  }
}

/**
 * Routes the connections the scope covers; see the module comment. On a board with pours, the connections the fills
 * make are left to them, and what the fills no longer join once the routes are laid is routed again (pour-rounds).
 */
export function routeBoard(input: RouteBoardInput, options: RouteBoardOptions = {}): RouteReport {
  const router = (given: RouteBoardInput, asked: RouteBoardOptions) => routeWithPours(given, asked, routeOnce)
  return ripUpAndRetry(input, router(input, options), withoutProgress(options), router)
}

/** The options for the runs after the main one, which do not report their progress. */
const withoutProgress = ({ onProgress: _, ...options }: RouteBoardOptions): RouteBoardOptions => options

/** One run over the layout's ratsnest: negotiation, settling, copies, cleanup. */
function routeOnce(input: RouteBoardInput, options: RouteBoardOptions): RouteReport {
  const clock = options.clock ?? (() => performance.now())
  const started = clock()
  const scope = options.scope ?? { kind: "all" }
  const world = routerWorld(input.layout, input.rules, classLookup(input.rules, input.nets))
  const connections = connectionsOf(world, input, linesIn(input, scope))
  const run: Run = {
    ...(options.maxExpansions === undefined ? {} : { maxExpansions: options.maxExpansions }),
    ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    world,
    congestion: new Congestion(world),
    buffers: new SearchBuffers(),
    failed: new Map(),
    late: lateness(clock, started, options.budgetMs),
  }
  const passes = connections.length === 0 ? 0 : negotiateAll(run, connections, options.maxPasses ?? MAX_PASSES)
  settle(run, connections)
  const routed = connections.flatMap((connection) => {
    const placed = run.congestion.placed.get(connection.index)
    return placed === undefined ? [] : [{ net: connection.line.net, from: connection.line.from, to: connection.line.to, copper: placed.copper, cost: placed.cost }]
  })
  const failures = connections.flatMap((connection) => run.failed.get(connection.index) ?? [])
  const copies = scope.kind === "instance" ? replicate(world, input, scope.instance, routed, run.congestion, { late: run.late, outOfTime: (from, to) => `${cannot(from, to)}: ${OUT_OF_TIME}` }) : undefined
  const all = copies === undefined ? { routed, unrouted: failures } : { routed: [...routed, ...copies.routed], unrouted: [...failures, ...copies.unrouted], replicas: copies.replicas }
  const report = { ...all, passes, budgetSpent: all.unrouted.some((one) => one.reason.endsWith(OUT_OF_TIME)) }
  if (run.late()) {
    options.onProgress?.({ stage: "cleanup", capped: false, skipped: true })
    return { ...report, edits: layoutEdits(report.routed), cleanupCapped: false, cleanupSkipped: true, budgetSpent: true, ms: clock() - started }
  }
  const cleaned = cleanupReport(input, report.routed, { world })
  options.onProgress?.({ stage: "cleanup", capped: cleaned.capped })
  return { ...report, routed: cleaned.routed, edits: layoutEdits(cleaned.routed), cleanupCapped: cleaned.capped, cleanupSkipped: false, ms: clock() - started }
}
