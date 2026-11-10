import type { Net } from "../model.js"
import type { PcbLayout, WorldPad } from "../pcb.js"
import { netClasses } from "../rules/classes.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import type { Rules } from "../rules/schema.js"
import { trackWidth, viaSize } from "../rules/track-defaults.js"
import { searchPath, type CellRef, type EndRef, type Penalties, type SearchBuffers } from "./astar.js"
import { blockingNames, endCells, joinedTo, padLegs } from "./ends.js"
import { isWholeBoard, rasteriseIn, routerWorld, wholeBoard, windowAround, type CellWindow, type NetRule, type RouterGrid, type RouterWorld } from "./grid.js"
import { boxOf, type Obstacle } from "./obstacles.js"
import { pathCopper, type RoutedCopper } from "./path.js"

/** What the router reads: the built layout, the rules and the circuit's nets. */
export interface RouteInput {
  layout: PcbLayout
  rules: Rules
  nets: readonly Net[]
}

export type ConnectionResult = { routed: true; copper: RoutedCopper; cost: number } | { routed: false; reason: string; blockers: string[] }

/** Around a connection's ends, the window first searched spans at least this much more on each side, in mm. */
const WINDOW_MARGIN = 4

export const listed = (words: readonly string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`)
const failed = (reason: string, blockers: string[] = []): ConnectionResult => ({ routed: false, reason, blockers })

/** A net's class by net id, as the copper checks see it: no net or an unclaimed one is the default class. */
export function classLookup(rules: Rules, nets: readonly Net[]): (net: string | undefined) => string {
  const byNet = netClasses(rules, nets).byNet
  return (net) => (net === undefined ? DEFAULT_CLASS.name : (byNet.get(net) ?? DEFAULT_CLASS.name))
}

/** The track width and via a net is routed with: its class's, raised to the fabrication minimums, as for hand-drawn copper. */
export function netRule(rules: Rules, nets: readonly Net[], netId: string): NetRule {
  const net: Net = nets.find((one) => one.id === netId) ?? { id: netId, names: [], pins: [] }
  return { net: netId, className: classLookup(rules, nets)(netId), width: trackWidth(rules, net), via: viaSize(rules, net) }
}

export const padName = (pad: WorldPad) => pad.pin ?? pad.id

/** "could not route R1.pin2 to R2.pin1" */
export const cannot = (from: WorldPad, to: WorldPad) => `could not route ${padName(from)} to ${padName(to)}`

/** Why there is no path: the objects named, or the search's bound. */
export function why(from: WorldPad, to: WorldPad, blockers: readonly string[], reason: "no-path" | "limit", expanded: number): string {
  const ends = cannot(from, to)
  if (reason === "limit") return `${ends}: the search gave up after ${expanded} steps`
  if (blockers.length === 0) return `${ends}: no room`
  return blockers.length === 1 ? `${ends}: no way past ${blockers[0]}` : `${ends}: no room between ${listed(blockers)}`
}

/** One connection to route: the net's rule, its two pads, and the copper already joined to each (the pad among it). */
export interface Job {
  rule: NetRule
  from: WorldPad
  to: WorldPad
  start: readonly Obstacle[]
  end: readonly Obstacle[]
}

export interface AttemptOptions {
  /** More copper to keep out, laid earlier in the run. */
  extra?: readonly Obstacle[]
  /** The extra cost of cells on the grid made for the attempt. */
  penalties?: (grid: RouterGrid, window: CellWindow) => Penalties | undefined
  buffers?: SearchBuffers
  maxExpansions?: number
}

export type Attempt =
  | { routed: true; copper: RoutedCopper; cost: number; steps: CellRef[]; grid: RouterGrid; window: CellWindow; penalties?: Penalties }
  | { routed: false; reason: string; blockers: string[]; noPath?: boolean }

interface Side {
  refs: EndRef[]
  at?: { x: number; y: number }
  blocked: string[]
}

/** The ends on the grid: the free cells on the island's copper, or else legs from the pad centre. */
function endsOf(world: RouterWorld, grid: RouterGrid, job: Job, which: "start" | "end", extra: readonly Obstacle[]): Side {
  const [pad, island] = which === "start" ? [job.from, job.start] : [job.to, job.end]
  const cells = endCells(grid, island)
  if (cells.length > 0) return { refs: cells, blocked: [] }
  const legs = padLegs(world, grid, job.rule, pad, extra)
  if (legs.ends.length > 0) return { refs: legs.ends, at: legs.at, blocked: [] }
  return { refs: [], blocked: blockingNames(grid, island.filter((piece) => piece.id === pad.id)) }
}

function attemptIn(world: RouterWorld, job: Job, window: CellWindow, options: AttemptOptions): Attempt {
  const extra = options.extra ?? []
  const grid = rasteriseIn(world, job.rule, window, extra)
  const start = endsOf(world, grid, job, "start", extra)
  const end = endsOf(world, grid, job, "end", extra)
  for (const [pad, side] of [[job.from, start], [job.to, end]] as const) {
    if (side.refs.length > 0) continue
    const by = side.blocked.length === 0 ? "" : `, blocked by ${listed(side.blocked)}`
    return { routed: false, reason: `${cannot(job.from, job.to)}: ${padName(pad)} has no free grid cell${by}`, blockers: side.blocked }
  }
  const penalties = options.penalties?.(grid, window)
  const search = { ...(penalties ? { penalties } : {}), ...(options.buffers ? { buffers: options.buffers } : {}), ...(options.maxExpansions === undefined ? {} : { maxExpansions: options.maxExpansions }) }
  const result = searchPath(grid, start.refs, end.refs, search)
  if (!result.found) return { routed: false, reason: why(job.from, job.to, result.blockers, result.reason, result.expanded), blockers: result.blockers, noPath: result.reason === "no-path" }
  const legs = { ...(start.at ? { start: start.at } : {}), ...(end.at ? { end: end.at } : {}) }
  return { routed: true, copper: pathCopper(grid, result.steps, job.rule, legs), cost: result.cost, steps: result.steps, grid, window, ...(penalties ? { penalties } : {}) }
}

/** The cells around the connection's two ends, grown by the margin (or half the ends' span, if larger). */
export function jobWindow(world: RouterWorld, job: Job): CellWindow {
  const shapes = [...job.start, ...job.end].flatMap((piece) => piece.shapes)
  const box = shapes.length > 0 ? boxOf(shapes) : { minX: Math.min(job.from.x, job.to.x), minY: Math.min(job.from.y, job.to.y), maxX: Math.max(job.from.x, job.to.x), maxY: Math.max(job.from.y, job.to.y) }
  const margin = Math.max(WINDOW_MARGIN, (box.maxX - box.minX) / 2, (box.maxY - box.minY) / 2)
  return windowAround(world, { minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin })
}

/** Routes the job in its window, and over the whole board when the window has no way through. */
export function attempt(world: RouterWorld, job: Job, options: AttemptOptions = {}): Attempt {
  const window = jobWindow(world, job)
  const first = attemptIn(world, job, window, options)
  if (first.routed || first.noPath !== true || isWholeBoard(world, window)) return first
  return attemptIn(world, job, wholeBoard(world), options)
}

/**
 * Routes one connection of a net: from the pad `fromId` (and the copper already joined to it) to the pad `toId` (and
 * its copper), on the board's layers, around everything of other nets. The result is the copper to lay, or why
 * there is none, naming the objects that closed the way.
 */
export function routeConnection(input: RouteInput, fromId: string, toId: string, options: { maxExpansions?: number } = {}): ConnectionResult {
  const pads = input.layout.parts.flatMap((part) => part.pads)
  const [from, to] = [pads.find((pad) => pad.id === fromId), pads.find((pad) => pad.id === toId)]
  if (from === undefined || to === undefined) return failed(`no pad ${from === undefined ? fromId : toId}`)
  if (from.net === undefined || from.net !== to.net) return failed(`${padName(from)} and ${padName(to)} are not on one net`)
  const world = routerWorld(input.layout, input.rules, classLookup(input.rules, input.nets))
  const byId = new Map(world.obstacles.map((piece) => [piece.id, piece]))
  const island = (padId: string) => joinedTo(input.layout, padId).flatMap((piece) => byId.get(piece.id) ?? [])
  const [start, end] = [island(fromId), island(toId)]
  if (start.some((piece) => piece.id === toId)) return failed(`${padName(from)} and ${padName(to)} are already connected`)
  const job: Job = { rule: netRule(input.rules, input.nets, from.net), from, to, start, end }
  const result = attempt(world, job, options)
  return result.routed ? { routed: true, copper: result.copper, cost: result.cost } : failed(result.reason, result.blockers)
}
