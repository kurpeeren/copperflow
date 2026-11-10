import type { Component, SheetInstance } from "../model.js"
import { naturalCompare } from "../order.js"
import type { RatsnestLine, WorldPad } from "../pcb.js"
import { SearchBuffers } from "./astar.js"
import { Congestion, clearOf, near, placeRoute, type Placed } from "./congestion.js"
import { attempt, classLookup, netRule, type Job, type RouteInput } from "./connect.js"
import { islandsOf } from "./ends.js"
import { routerWorld, type NetRule, type RouterWorld } from "./grid.js"
import type { Obstacle } from "./obstacles.js"
import type { RoutedCopper } from "./path.js"
import { replicate, type Replica } from "./replicate.js"

/**
 * The whole job: the connections the ratsnest still misses (all of them, or those of some nets, of some parts, or
 * inside one sub-sheet instance), routed shortest first and negotiated until no two nets want the same room, or the
 * pass cap is reached. Then what is still contested is settled in the same order: each route clear of the routes kept
 * before it stays, the others are routed once more around those as walls, and what cannot be is reported with the
 * pins and the objects in the way. An instance's routes are then copied to the other instances of its sheet whose
 * placement matches.
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

export interface RouteBoardOptions {
  scope?: RouteScope
  /** The most negotiation passes; 30 by default. */
  maxPasses?: number
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
  ms: number
  /** With the instance scope: what became of each other instance of the sheet. */
  replicas?: Replica[]
}

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
  world: RouterWorld
  congestion: Congestion
  buffers: SearchBuffers
  failed: Map<number, UnroutedConnection>
}

const unrouted = (connection: Connection, reason: string, blockers: string[]): UnroutedConnection => ({ net: connection.line.net, from: connection.line.from, to: connection.line.to, reason, blockers })

/** Routes one connection in pass `pass` against the others' copper as a cost; returns the routes it is in conflict with. */
function negotiate(run: Run, connection: Connection, pass: number): Set<number> | undefined {
  const { world, congestion } = run
  congestion.placed.delete(connection.index)
  let occupancy: ReturnType<Congestion["costs"]> | undefined
  const result = attempt(world, connection.job, {
    extra: congestion.holes(),
    buffers: run.buffers,
    penalties: (grid, window) => {
      occupancy = congestion.costs(connection.job.rule, grid, window, pass)
      return occupancy.penalties
    },
  })
  if (!result.routed) {
    run.failed.set(connection.index, unrouted(connection, result.reason, result.blockers))
    return undefined
  }
  const placed = placeRoute(world, connection.index, result.copper, connection.job.rule.className, result.steps, result.grid, result.window, legsOf(result.copper, connection.job), result.cost)
  congestion.placed.set(connection.index, placed)
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
    for (const connection of pending) {
      const others = negotiate(run, connection, pass)
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
    if (placed === undefined) continue
    const rule = connection.job.rule
    if (clearOf(world, rule, placed, kept.filter((other) => other.net !== placed.net && near(world, rule, placed.box, other.box)))) {
      kept.push(placed)
      continue
    }
    congestion.placed.delete(connection.index)
    const walls = [...kept.flatMap((other) => other.pieces), ...congestion.holes()]
    const result = attempt(world, connection.job, { extra: walls, buffers: run.buffers })
    if (!result.routed) {
      run.failed.set(connection.index, unrouted(connection, result.reason, result.blockers))
      continue
    }
    const again = placeRoute(world, connection.index, result.copper, rule.className, result.steps, result.grid, result.window, legsOf(result.copper, connection.job), result.cost)
    congestion.placed.set(connection.index, again)
    kept.push(again)
  }
}

/** Routes the connections the scope covers; see the module comment. */
export function routeBoard(input: RouteBoardInput, options: RouteBoardOptions = {}): RouteReport {
  const started = performance.now()
  const scope = options.scope ?? { kind: "all" }
  const world = routerWorld(input.layout, input.rules, classLookup(input.rules, input.nets))
  const connections = connectionsOf(world, input, linesIn(input, scope))
  const run: Run = { world, congestion: new Congestion(world), buffers: new SearchBuffers(), failed: new Map() }
  const passes = connections.length === 0 ? 0 : negotiateAll(run, connections, options.maxPasses ?? MAX_PASSES)
  settle(run, connections)
  const routed = connections.flatMap((connection) => {
    const placed = run.congestion.placed.get(connection.index)
    return placed === undefined ? [] : [{ net: connection.line.net, from: connection.line.from, to: connection.line.to, copper: placed.copper, cost: placed.cost }]
  })
  const failures = connections.flatMap((connection) => run.failed.get(connection.index) ?? [])
  const report: RouteReport = { routed, unrouted: failures, passes, ms: 0 }
  const copies = scope.kind === "instance" ? replicate(world, input, scope.instance, routed, run.congestion) : undefined
  const result = copies === undefined ? report : { ...report, routed: [...routed, ...copies.routed], unrouted: [...failures, ...copies.unrouted], replicas: copies.replicas }
  return { ...result, ms: performance.now() - started }
}
