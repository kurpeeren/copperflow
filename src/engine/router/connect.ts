import type { Net } from "../model.js"
import type { PcbLayout, WorldPad } from "../pcb.js"
import { netClasses } from "../rules/classes.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import type { Rules } from "../rules/schema.js"
import { trackWidth, viaSize } from "../rules/track-defaults.js"
import { DIAGONAL, searchPath, STEP, VIA, type CellRef, type EndRef, type Penalties, type SearchBuffers, type SearchOptions } from "./astar.js"
import { blockingNames, endCells, joinedTo, padLegs } from "./ends.js"
import { cellCentre, cellsNear, isWholeBoard, rasteriseIn, routerWorld, wholeBoard, windowAround, type CellWindow, type NetRule, type RouterGrid, type RouterWorld } from "./grid.js"
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
  | { routed: false; reason: string; blockers: string[]; noPath?: boolean; limit?: boolean }

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
  const spaced = spacedSearch(world, grid, job, start.refs, end.refs, search)
  if (spaced.failure !== undefined) return spaced.failure
  const legs = { ...(start.at ? { start: start.at } : {}), ...(end.at ? { end: end.at } : {}) }
  const { steps, cost } = spaced
  return { routed: true, copper: pathCopper(spaced.grid, steps, job.rule, legs), cost, steps, grid: spaced.grid, window, ...(penalties ? { penalties } : {}) }
}

/** How many times a search is run again with via cells closed, when its own vias come too near each other. */
const SPACING_RETRIES = 6
const OWN_VIA = "the route's own via"

/** The first via of the path too near a later one, as a cell, or undefined when all keep the hole spacing. */
function crowdedVia(grid: RouterGrid, steps: readonly CellRef[], rule: NetRule, spacing: number): number | undefined {
  const vias = steps.flatMap((step, i) => (i > 0 && steps[i - 1]?.layer !== step.layer ? [step.cell] : []))
  const need = rule.via.drill + spacing
  for (const [i, a] of vias.entries()) {
    const p = cellCentre(grid, a)
    for (const b of vias.slice(i + 1)) {
      const q = cellCentre(grid, b)
      if (Math.hypot(p.x - q.x, p.y - q.y) < need - 1e-9) return a
    }
  }
  return undefined
}

type Spaced = { failure?: undefined; grid: RouterGrid; steps: CellRef[]; cost: number } | { failure: Attempt & { routed: false } }

/**
 * The search, kept to paths whose own vias keep the fabrication hole spacing from each other: when two come too near,
 * the via cells around the first (but its own) are closed and the search is run again, a bounded number of times.
 */
function spacedSearch(world: RouterWorld, first: RouterGrid, job: Job, sources: readonly EndRef[], targets: readonly EndRef[], search: SearchOptions): Spaced {
  const spacing = world.rules.fabrication.minHoleToHole
  let grid = first
  for (let tries = 0; ; tries++) {
    const result = searchPath(grid, sources, targets, search)
    if (!result.found) {
      const failure = { routed: false as const, reason: why(job.from, job.to, result.blockers, result.reason, result.expanded), blockers: result.blockers, noPath: result.reason === "no-path", ...(result.reason === "limit" ? { limit: true } : {}) }
      return { failure }
    }
    const crowded = crowdedVia(grid, result.steps, job.rule, spacing)
    if (crowded === undefined) return { grid, steps: result.steps, cost: result.cost }
    if (tries >= SPACING_RETRIES) return { failure: { routed: false, reason: `${cannot(job.from, job.to)}: its vias cannot keep the ${spacing} mm hole spacing`, blockers: [] } }
    if (grid === first) grid = { ...first, via: Int32Array.from(first.via), blockers: [...first.blockers, OWN_VIA] }
    const index = grid.blockers.length - 1
    const via = grid.via
    cellsNear(grid, { core: [cellCentre(grid, crowded)], radius: 0 }, job.rule.via.drill + spacing, (cell) => {
      if (cell !== crowded) via[cell] = index
    })
  }
}

/** The cells around the connection's two ends, grown by the margin (or half the ends' span, if larger). */
export function jobWindow(world: RouterWorld, job: Job, scale = 1): CellWindow {
  const shapes = [...job.start, ...job.end].flatMap((piece) => piece.shapes)
  const box = shapes.length > 0 ? boxOf(shapes) : { minX: Math.min(job.from.x, job.to.x), minY: Math.min(job.from.y, job.to.y), maxX: Math.max(job.from.x, job.to.x), maxY: Math.max(job.from.y, job.to.y) }
  const margin = scale * Math.max(WINDOW_MARGIN, (box.maxX - box.minX) / 2, (box.maxY - box.minY) / 2)
  return windowAround(world, { minX: box.minX - margin, minY: box.minY - margin, maxX: box.maxX + margin, maxY: box.maxY + margin })
}

/** A path dearer than this many times the plain distance between the pads is tried once more in a wider window. */
const DETOUR_FACTOR = 3
/** How much wider that window's margin is. */
const WIDER = 3

/**
 * What a route between the two pad centres costs without congestion, at a guess: the straight 45° run on the grid and
 * room for two vias (a pass under something), so a route is not widened only for changing layer.
 */
function plainCost(world: RouterWorld, job: Job): number {
  const [dx, dy] = [Math.abs(job.from.x - job.to.x) / world.frame.pitch, Math.abs(job.from.y - job.to.y) / world.frame.pitch]
  return STEP * Math.max(dx, dy) + (DIAGONAL - STEP) * Math.min(dx, dy) + 2 * VIA
}

const sameWindow = (a: CellWindow, b: CellWindow) => a.col0 === b.col0 && a.row0 === b.row0 && a.col1 === b.col1 && a.row1 === b.row1

/**
 * Routes the job in its window, and over the whole board when the window has no way through. Under penalties a
 * window always has a way, perhaps a dear one: a path over DETOUR_FACTOR times the plain cost is tried once more in a
 * window WIDER times as wide, and the cheaper of the two is kept.
 */
export function attempt(world: RouterWorld, job: Job, options: AttemptOptions = {}): Attempt {
  const window = jobWindow(world, job)
  const first = attemptIn(world, job, window, options)
  if (first.routed) {
    if (options.penalties === undefined || first.cost <= DETOUR_FACTOR * plainCost(world, job)) return first
    const wide = jobWindow(world, job, WIDER)
    if (sameWindow(wide, window)) return first
    const second = attemptIn(world, job, wide, options)
    return second.routed && second.cost < first.cost ? second : first
  }
  if (first.noPath !== true || isWholeBoard(world, window)) return first
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
