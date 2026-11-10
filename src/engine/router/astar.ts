import { separating } from "./blockers.js"
import { FREE, type RouterGrid } from "./grid.js"

/**
 * A* on the router grid: the cheapest path from any source cell to any target cell, moving to the 8 neighbours on a
 * layer or through a via to another layer. A state is a cell, its layer and the direction the path arrived in, so a
 * corner is a change of direction: 45° costs a little, 90° more, and sharper turns are not taken. A via costs as much
 * as 20 steps, so the path stays on a layer unless changing pays.
 *
 * The estimate is the octile distance to the box around the targets of a layer (plus a via for a layer other than
 * the state's), the smallest over the layers with targets. It never falls by more than a move costs, so it is
 * consistent: the first time a state is taken it is at its cheapest, and no state is reopened. The queue orders by
 * estimate, then by the smaller remaining estimate, then by state number, so the same grid gives the same path.
 * The search gives up after `maxExpansions` states. With no path, it names the objects between the two ends.
 */

export const STEP = 10
export const DIAGONAL = 14
export const TURN_45 = 4
export const TURN_90 = 12
export const VIA = 20 * STEP
/**
 * The most a path may cost: a cost that would pass it stays there, so the Int32 costs never wrap. Cell penalties are
 * kept to at most 2^20 each, so only a path over a thousand fully priced cells reaches it.
 */
export const COST_CAP = 2 ** 30
/** States taken before the search gives up, unless the caller sets another bound. */
export const DEFAULT_MAX_EXPANSIONS = 1_000_000

/** East, north-east, north, …, south-east: odd directions are diagonal. NONE is a path's start or a via. */
const DCOL = [1, 1, 0, -1, -1, -1, 0, 1] as const
const DROW = [0, 1, 1, 1, 0, -1, -1, -1] as const
const NONE = 8
const DIRECTIONS = 9
/** Turns of 135° and more (in eighths of a full turn: 3 and 4) are never taken. */
const TURN_COST = [0, TURN_45, TURN_90] as const

/** A cell on one layer: `layer` indexes the grid's layers. */
export interface CellRef {
  layer: number
  cell: number
}

/** A start or an end of a search: a cell, and what reaching it from off the grid (a leg from a pad centre) costs. */
export interface EndRef extends CellRef {
  cost?: number
}

export type SearchResult =
  | { found: true; steps: CellRef[]; cost: number }
  | { found: false; reason: "no-path" | "limit"; expanded: number; blockers: string[] }

/** What entering a cell costs on top of the move, per layer, and what a via there costs on top of VIA. */
export interface Penalties {
  track: readonly Int32Array[]
  via: Int32Array
}

export interface SearchOptions {
  maxExpansions?: number
  penalties?: Penalties
  /** Arrays kept from one search to the next, so a run of searches allocates them once. */
  buffers?: SearchBuffers
}

/**
 * The per-state arrays of a search. A state's cost and parent are valid only when its mark is the current search's
 * number, so a new search needs no clearing.
 */
export class SearchBuffers {
  cost = new Int32Array(0)
  parent = new Int32Array(0)
  seen = new Uint32Array(0)
  closed = new Uint32Array(0)
  private search = 0

  /** Starts a search over `states` states, and returns its number. */
  begin(states: number): number {
    if (this.seen.length < states || this.search >= 0xfffffffe) {
      const size = Math.max(states, this.seen.length)
      this.cost = new Int32Array(size)
      this.parent = new Int32Array(size)
      this.seen = new Uint32Array(size)
      this.closed = new Uint32Array(size)
      this.search = 0
    }
    return ++this.search
  }
}

/** States by estimate, a binary heap; ties go to the smaller remaining estimate, then the smaller state. */
class Queue {
  private readonly f: number[] = []
  private readonly h: number[] = []
  private readonly s: number[] = []

  get size(): number {
    return this.s.length
  }

  push(f: number, h: number, s: number): void {
    this.f.push(f)
    this.h.push(h)
    this.s.push(s)
    let i = this.s.length - 1
    while (i > 0) {
      const up = (i - 1) >> 1
      if (!this.before(i, up)) break
      this.swap(i, up)
      i = up
    }
  }

  pop(): number {
    const top = this.s[0] as number
    const last = this.s.length - 1
    this.swap(0, last)
    this.f.pop()
    this.h.pop()
    this.s.pop()
    let i = 0
    for (;;) {
      const [l, r] = [2 * i + 1, 2 * i + 2]
      let best = i
      if (l < this.s.length && this.before(l, best)) best = l
      if (r < this.s.length && this.before(r, best)) best = r
      if (best === i) return top
      this.swap(i, best)
      i = best
    }
  }

  private before(a: number, b: number): boolean {
    const [fa, fb] = [this.f[a] as number, this.f[b] as number]
    if (fa !== fb) return fa < fb
    const [ha, hb] = [this.h[a] as number, this.h[b] as number]
    return ha !== hb ? ha < hb : (this.s[a] as number) < (this.s[b] as number)
  }

  private swap(a: number, b: number): void {
    for (const list of [this.f, this.h, this.s]) [list[a], list[b]] = [list[b] as number, list[a] as number]
  }
}

interface Box {
  col0: number
  col1: number
  row0: number
  row1: number
}

/** The box around each layer's targets, or undefined for a layer without one. */
function targetBoxes(grid: RouterGrid, targets: readonly CellRef[]): (Box | undefined)[] {
  const boxes: (Box | undefined)[] = grid.layers.map(() => undefined)
  for (const { layer, cell } of targets) {
    const [col, row] = [cell % grid.cols, Math.floor(cell / grid.cols)]
    const box = boxes[layer]
    boxes[layer] = box === undefined ? { col0: col, col1: col, row0: row, row1: row } : { col0: Math.min(box.col0, col), col1: Math.max(box.col1, col), row0: Math.min(box.row0, row), row1: Math.max(box.row1, row) }
  }
  return boxes
}

function octile(box: Box, col: number, row: number): number {
  const dc = Math.max(box.col0 - col, 0, col - box.col1)
  const dr = Math.max(box.row0 - row, 0, row - box.row1)
  return STEP * Math.max(dc, dr) + (DIAGONAL - STEP) * Math.min(dc, dr)
}

const turnOf = (from: number, to: number): number => (from === NONE ? 0 : Math.min(Math.abs(from - to), 8 - Math.abs(from - to)))

/** The estimate from a node to the nearest target box: octile on its layer, or octile plus a via to another layer. */
function estimator(grid: RouterGrid, goals: readonly CellRef[]): (layer: number, cell: number) => number {
  const boxes = targetBoxes(grid, goals)
  const layers = boxes.flatMap((box, layer) => (box === undefined ? [] : [{ box, layer }]))
  return (layer, cell) => {
    const [col, row] = [cell % grid.cols, Math.floor(cell / grid.cols)]
    let best = Infinity
    for (const target of layers) best = Math.min(best, octile(target.box, col, row) + (target.layer === layer ? 0 : VIA))
    return best
  }
}

/** The cost of the leg off the grid at each target node, by node; -1 where there is no target. */
function goalCosts(cells: number, goals: readonly EndRef[], layers: number): Int32Array {
  const extra = new Int32Array(layers * cells).fill(-1)
  for (const { layer, cell, cost } of goals) {
    const node = layer * cells + cell
    const own = cost ?? 0
    if (extra[node] === -1 || own < (extra[node] as number)) extra[node] = own
  }
  return extra
}

/**
 * The cheapest path from a source to a target, or why there is none. Blocked sources and targets are left out. A
 * source's cost starts its path; a target's cost is added when the path ends there (the first target taken ends the
 * search, so a target with a costly leg is preferred over a cheaper one only as the estimate orders them).
 */
export function searchPath(grid: RouterGrid, sources: readonly EndRef[], targets: readonly EndRef[], options: SearchOptions = {}): SearchResult {
  const cells = grid.cols * grid.rows
  const open = (ref: CellRef) => grid.track[ref.layer]?.[ref.cell] === FREE
  const goals = targets.filter(open)
  const goalCost = goalCosts(cells, goals, grid.layers.length)
  const estimate = estimator(grid, goals)
  const buffers = options.buffers ?? new SearchBuffers()
  const search = buffers.begin(grid.layers.length * cells * DIRECTIONS)
  const { cost, parent, seen, closed } = buffers
  const penalties = options.penalties
  const queue = new Queue()
  const reach = (state: number, paid: number, from: number, node: number): void => {
    const g = Math.min(paid, COST_CAP)
    if (seen[state] === search && g >= (cost[state] as number)) return
    seen[state] = search
    cost[state] = g
    parent[state] = from
    const h = estimate(Math.floor(node / cells), node % cells)
    queue.push(g + h, h, state)
  }
  const starts = sources.filter(open)
  if (goals.length > 0) for (const ref of starts) reach((ref.layer * cells + ref.cell) * DIRECTIONS + NONE, ref.cost ?? 0, -1, ref.layer * cells + ref.cell)
  const limit = options.maxExpansions ?? DEFAULT_MAX_EXPANSIONS
  let expanded = 0
  while (queue.size > 0) {
    const state = queue.pop()
    if (closed[state] === search) continue
    closed[state] = search
    if (++expanded > limit) return { found: false, reason: "limit", expanded: limit, blockers: [] }
    const node = Math.floor(state / DIRECTIONS)
    const g = cost[state] as number
    if ((goalCost[node] as number) >= 0) return { found: true, steps: stepsTo(parent, state, cells), cost: Math.min(g + (goalCost[node] as number), COST_CAP) }
    const [layer, cell, dir] = [Math.floor(node / cells), node % cells, state % DIRECTIONS]
    const [col, row] = [cell % grid.cols, Math.floor(cell / grid.cols)]
    const map = grid.track[layer] as Int32Array
    const extra = penalties?.track[layer]
    for (let d = 0; d < 8; d++) {
      const turn = turnOf(dir, d)
      if (turn > 2) continue
      const [c, r] = [col + (DCOL[d] as number), row + (DROW[d] as number)]
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue
      const to = r * grid.cols + c
      if (map[to] !== FREE) continue
      const next = layer * cells + to
      const step = (d % 2 === 1 ? DIAGONAL : STEP) + (TURN_COST[turn] as number) + (extra === undefined ? 0 : (extra[to] as number))
      reach(next * DIRECTIONS + d, g + step, state, next)
    }
    if (grid.via[cell] !== FREE) continue
    const viaCost = VIA + (penalties === undefined ? 0 : (penalties.via[cell] as number))
    for (let l = 0; l < grid.layers.length; l++) {
      if (l === layer || grid.track[l]?.[cell] !== FREE) continue
      const landing = penalties === undefined ? 0 : (penalties.track[l]?.[cell] as number)
      reach((l * cells + cell) * DIRECTIONS + NONE, g + viaCost + landing, state, l * cells + cell)
    }
  }
  return { found: false, reason: "no-path", expanded, blockers: separating(grid, starts, goals) }
}

function stepsTo(parent: Int32Array, last: number, cells: number): CellRef[] {
  const steps: CellRef[] = []
  for (let state = last; state !== -1; state = parent[state] as number) {
    const node = Math.floor(state / DIRECTIONS)
    steps.push({ layer: Math.floor(node / cells), cell: node % cells })
  }
  return steps.reverse()
}
