import { COPPER_LAYERS } from "../../core/layout-file.js"
import type { Shape } from "../checks/geometry.js"
import type { Box } from "../checks/grid-index.js"
import type { Point } from "../model.js"
import { STEP, type CellRef, type Penalties } from "./astar.js"
import { offenders } from "./clear.js"
import { cellsNear, foreignReach, grow, windowBox, type CellWindow, type NetRule, type RouterGrid, type RouterWorld } from "./grid.js"
import { KEEP_COST, type KeepClear } from "./keep-clear.js"
import { boxOf, type Obstacle } from "./obstacles.js"
import type { PathLegs, RoutedCopper } from "./path.js"

/**
 * Negotiated congestion. A connection routed in a pass sees the copper other nets were given so far as a cost, not a
 * wall: entering a cell another net's copper keeps a track out of costs the present price (which rises each pass),
 * plus the cell's history (which rises each pass the cell is fought over). Where a route still takes such a cell it
 * is in conflict, and it and the route it overlaps are routed again in the next pass. A pass without conflict leaves
 * every route clear of every other net's: a route whose centre line keeps out of another's grown copper keeps the gap.
 */

/** What a cell another net holds costs in pass `pass`. */
export const presentPrice = (pass: number): number => Math.min(Math.round(4 * STEP * 1.6 ** (pass - 1)), MAX_PRICE)
/** The most a cell's price or its history may reach, and so the most a cell costs (see COST_CAP in the search). */
export const MAX_PRICE = 2 ** 20
const capped = (value: number) => Math.min(value, MAX_PRICE)
/** What a fought-over cell's history rises by each pass. */
export const HISTORY_STEP = 3 * STEP

/** The board cells another net's copper keeps a net's tracks (per layer) and vias out of. */
interface Footprint {
  track: Int32Array[]
  via: Int32Array
}

/** A route laid in the run: its copper as obstacles, the box around them, its path and its footprints by rule. */
export interface Placed {
  index: number
  net: string
  copper: RoutedCopper
  pieces: Obstacle[]
  box: Box
  /** The path's cells on the board (layer, board cell) and the board cells of its vias. */
  nodes: CellRef[]
  vias: number[]
  legs: PathLegs
  /** What the search paid for the path. */
  cost: number
  footprints: Map<string, Footprint>
}

const ruleKey = (rule: NetRule) => `${rule.className}|${rule.width}|${rule.via.diameter}`

/** The copper as obstacles named by `id`: tracks segment by segment, vias over every layer with their holes. */
export function copperObstacles(copper: RoutedCopper, className: string, id: string = copper.net): Obstacle[] {
  const tracks = copper.tracks.map((track): Obstacle => {
    const shapes: Shape[] = track.points.length === 1 ? [{ core: [track.points[0] as Point], radius: track.width / 2 }] : track.points.slice(1).map((p, i) => ({ core: [track.points[i] as Point, p], radius: track.width / 2 }))
    return { id, kind: "track", net: copper.net, className, layers: [track.layer], shapes, at: track.points[0] as Point, box: boxOf(shapes) }
  })
  const vias = copper.vias.map((via): Obstacle => {
    const shapes = [{ core: [via.at], radius: via.diameter / 2 }]
    return { id, kind: "via", net: copper.net, className, layers: COPPER_LAYERS, shapes, at: via.at, box: boxOf(shapes), hole: { core: [via.at], radius: via.drill / 2 } }
  })
  return [...tracks, ...vias]
}

/** Only the holes of the vias: what keeps vias apart whatever their nets, while their copper is negotiated. */
export const holesOnly = (pieces: readonly Obstacle[]): Obstacle[] => pieces.filter((piece) => piece.hole !== undefined).map((piece) => ({ ...piece, layers: [], shapes: [] }))

/** A window cell's board cell. */
const boardCell = (world: RouterWorld, window: CellWindow, grid: RouterGrid, cell: number) => (window.row0 + Math.floor(cell / grid.cols)) * world.frame.cols + window.col0 + (cell % grid.cols)

/** The route as laid: its pieces, path cells on the board, and via cells. */
export function placeRoute(world: RouterWorld, index: number, copper: RoutedCopper, className: string, steps: readonly CellRef[], grid: RouterGrid, window: CellWindow, legs: PathLegs, cost = 0): Placed {
  const pieces = copperObstacles(copper, className)
  const nodes = steps.map((step) => ({ layer: step.layer, cell: boardCell(world, window, grid, step.cell) }))
  const vias = nodes.flatMap((node, i) => (i > 0 && nodes[i - 1]?.layer !== node.layer ? [node.cell] : []))
  return { index, net: copper.net, copper, pieces, box: pieces.length > 0 ? boxOf(pieces.flatMap((piece) => piece.shapes)) : { minX: 0, minY: 0, maxX: 0, maxY: 0 }, nodes, vias, legs, cost, footprints: new Map() }
}

/** The board cells the route's copper keeps the rule's tracks and vias out of, each once. */
function footprintFor(world: RouterWorld, placed: Placed, rule: NetRule): Footprint {
  const key = ruleKey(rule)
  const known = placed.footprints.get(key)
  if (known !== undefined) return known
  const { frame } = world
  const track = frame.layers.map(() => new Set<number>())
  const via = new Set<number>()
  for (const piece of placed.pieces) {
    const reach = foreignReach(world, rule, piece.className)
    frame.layers.forEach((layer, l) => {
      if (!piece.layers.includes(layer)) return
      for (const shape of piece.shapes) cellsNear(frame, shape, reach.track, (cell) => track[l]?.add(cell))
    })
    for (const shape of piece.shapes) cellsNear(frame, shape, reach.via, (cell) => via.add(cell))
  }
  const sorted = (cells: Set<number>) => Int32Array.from([...cells].sort((a, b) => a - b))
  const footprint = { track: track.map(sorted), via: sorted(via) }
  placed.footprints.set(key, footprint)
  return footprint
}

const overlaps = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY

/** Whether copper in box `b` can come near enough to box `a` to keep the rule's tracks or vias out of it. */
export const near = (world: RouterWorld, rule: NetRule, a: Box, b: Box): boolean => overlaps(grow(a, world.widestGap + rule.width + rule.via.diameter + world.frame.pitch), b)

/** The board's congestion: the history of each cell (per layer, and for vias) and the routes laid. */
export class Congestion {
  readonly history: Int32Array[]
  readonly viaHistory: Int32Array
  readonly placed = new Map<number, Placed>()

  constructor(
    private readonly world: RouterWorld,
    private readonly keep?: KeepClear,
  ) {
    const cells = world.frame.cols * world.frame.rows
    this.history = world.frame.layers.map(() => new Int32Array(cells))
    this.viaHistory = new Int32Array(cells)
  }

  /** The routes of other nets whose copper comes near the box, in index order. */
  others(net: string, box: Box, rule: NetRule): Placed[] {
    return [...this.placed.values()].filter((p) => p.net !== net && near(this.world, rule, box, p.box)).sort((a, b) => a.index - b.index)
  }

  /** Every via hole laid, as hole-only obstacles: a via keeps the hole spacing from them whatever the net. */
  holes(): Obstacle[] {
    return [...this.placed.values()].sort((a, b) => a.index - b.index).flatMap((p) => holesOnly(p.pieces))
  }

  /**
   * The costs of the window's cells for the rule's net in pass `pass`, and which other route holds each cell
   * (every one of them), for telling afterwards where the route laid on that grid is in conflict.
   */
  costs(rule: NetRule, grid: RouterGrid, window: CellWindow, pass: number): Occupancy {
    const { frame } = this.world
    const cells = grid.cols * grid.rows
    const owners = new Map<number, number[]>()
    const viaOwners = new Map<number, number[]>()
    const hold = (map: Map<number, number[]>, key: number, index: number) => map.set(key, [...(map.get(key) ?? []), index])
    const inWindow = (board: number) => {
      const [col, row] = [(board % frame.cols) - window.col0, Math.floor(board / frame.cols) - window.row0]
      return col < 0 || row < 0 || col >= grid.cols || row >= grid.rows ? -1 : row * grid.cols + col
    }
    const count = grid.layers.map(() => new Int32Array(cells))
    const viaCount = new Int32Array(cells)
    for (const other of this.others(rule.net, windowBox(this.world, window), rule)) {
      const footprint = footprintFor(this.world, other, rule)
      footprint.track.forEach((list, l) => {
        for (const board of list) {
          const cell = inWindow(board)
          if (cell < 0) continue
          ;(count[l] as Int32Array)[cell] = ((count[l] as Int32Array)[cell] as number) + 1
          hold(owners, l * cells + cell, other.index)
        }
      })
      for (const board of footprint.via) {
        const cell = inWindow(board)
        if (cell < 0) continue
        viaCount[cell] = (viaCount[cell] as number) + 1
        hold(viaOwners, cell, other.index)
      }
    }
    const price = presentPrice(pass)
    const track = grid.layers.map(() => new Int32Array(cells))
    const via = new Int32Array(cells)
    const own = this.keep === undefined ? -1 : this.keep.nets.indexOf(rule.net) + 1
    const keepCost = (l: number, board: number) => {
      const holder = this.keep?.track[l]?.[board] ?? 0
      return holder !== 0 && holder !== own ? KEEP_COST : 0
    }
    for (let cell = 0; cell < cells; cell++) {
      const board = (window.row0 + Math.floor(cell / grid.cols)) * frame.cols + window.col0 + (cell % grid.cols)
      for (let l = 0; l < grid.layers.length; l++) (track[l] as Int32Array)[cell] = capped(((this.history[l] as Int32Array)[board] as number) + price * ((count[l] as Int32Array)[cell] as number) + keepCost(l, board))
      via[cell] = capped((this.viaHistory[board] as number) + price * (viaCount[cell] as number))
    }
    return { penalties: { track, via }, owners, viaOwners }
  }

  /**
   * Where the route laid on the grid is in conflict: the routes it overlaps (their indexes), after raising the
   * history of the cells fought over. A leg off the grid is checked exactly against the other routes' copper.
   */
  conflicts(world: RouterWorld, rule: NetRule, placed: Placed, occupancy: Occupancy, grid: RouterGrid, window: CellWindow): Set<number> {
    const found = new Set<number>()
    const { frame } = world
    const local = (board: number) => (Math.floor(board / frame.cols) - window.row0) * grid.cols + (board % frame.cols) - window.col0
    const cells = grid.cols * grid.rows
    for (const node of placed.nodes) {
      const who = occupancy.owners.get(node.layer * cells + local(node.cell))
      if (who === undefined) continue
      for (const index of who) found.add(index)
      ;(this.history[node.layer] as Int32Array)[node.cell] = capped(((this.history[node.layer] as Int32Array)[node.cell] as number) + HISTORY_STEP)
    }
    for (const cell of placed.vias) {
      const who = occupancy.viaOwners.get(local(cell))
      if (who === undefined) continue
      for (const index of who) found.add(index)
      this.viaHistory[cell] = capped((this.viaHistory[cell] as number) + HISTORY_STEP)
    }
    for (const who of legConflicts(world, rule, placed, this.others(rule.net, placed.box, rule))) found.add(who)
    return found
  }
}

/** The window's penalties, and which routes hold each cell: by layer · cells + cell for tracks, by cell for vias. */
export interface Occupancy {
  penalties: Penalties
  owners: Map<number, number[]>
  viaOwners: Map<number, number[]>
}

/** The routes a leg of the placed route comes too near to, checked exactly. */
function legConflicts(world: RouterWorld, rule: NetRule, placed: Placed, others: readonly Placed[]): number[] {
  const legs = [placed.legs.start, placed.legs.end].filter((p): p is Point => p !== undefined)
  if (legs.length === 0 || others.length === 0) return []
  const pieces = others.flatMap((other) => other.pieces.map((piece) => ({ ...piece, id: String(other.index) })))
  const legShapes = placed.pieces.filter((piece) => piece.kind === "track" && piece.shapes.some((shape) => shape.core.some((p) => legs.some((leg) => leg.x === p.x && leg.y === p.y))))
  const hit = new Set<number>()
  for (const piece of legShapes) {
    for (const name of offenders(world, rule, { kind: "track", layers: piece.layers, shapes: piece.shapes }, pieces)) {
      const index = Number(name)
      if (Number.isInteger(index) && name === String(index)) hit.add(index)
    }
  }
  return [...hit]
}

/** Whether the placed route keeps clear of the given routes of other nets: its path off their footprints, its legs exactly. */
export function clearOf(world: RouterWorld, rule: NetRule, placed: Placed, others: readonly Placed[]): boolean {
  if (others.length === 0) return true
  const mine = new Set(placed.nodes.map((node) => node.layer * world.frame.cols * world.frame.rows + node.cell))
  const myVias = new Set(placed.vias)
  const cells = world.frame.cols * world.frame.rows
  for (const other of others) {
    const footprint = footprintFor(world, other, rule)
    for (let l = 0; l < footprint.track.length; l++) for (const cell of footprint.track[l] as Int32Array) if (mine.has(l * cells + cell)) return false
    for (const cell of footprint.via) if (myVias.has(cell)) return false
  }
  return legConflicts(world, rule, placed, others).length === 0
}
