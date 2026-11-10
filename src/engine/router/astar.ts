import { naturalCompare } from "../order.js"
import { BOARD_EDGE, FREE, type RouterGrid } from "./grid.js"

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
 * The search gives up after `maxExpansions` states.
 */

export const STEP = 10
export const DIAGONAL = 14
export const TURN_45 = 4
export const TURN_90 = 12
export const VIA = 20 * STEP
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

export type SearchResult =
  | { found: true; steps: CellRef[]; cost: number }
  | { found: false; reason: "no-path" | "limit"; expanded: number; blockers: string[] }

export interface SearchOptions {
  maxExpansions?: number
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

/** The objects next to the explored cells, on their layer: what closed the way. The board edge only when nothing else did. */
function blockersAround(grid: RouterGrid, closed: Uint8Array): string[] {
  const found = new Set<string>()
  const cells = grid.cols * grid.rows
  const explored = (node: number) => closed.subarray(node * DIRECTIONS, (node + 1) * DIRECTIONS).includes(1)
  for (let node = 0; node < grid.layers.length * cells; node++) {
    if (!explored(node)) continue
    const [layer, cell] = [Math.floor(node / cells), node % cells]
    const map = grid.track[layer] as Int32Array
    const [col, row] = [cell % grid.cols, Math.floor(cell / grid.cols)]
    for (let d = 0; d < 8; d++) {
      const [c, r] = [col + (DCOL[d] as number), row + (DROW[d] as number)]
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue
      const index = map[r * grid.cols + c] as number
      if (index !== FREE) found.add(grid.blockers[index] as string)
    }
  }
  const names = [...found].sort(naturalCompare)
  return names.length > 1 ? names.filter((name) => name !== BOARD_EDGE) : names
}

/** The cheapest path from a source to a target, or why there is none. Blocked sources and targets are left out. */
export function searchPath(grid: RouterGrid, sources: readonly CellRef[], targets: readonly CellRef[], options: SearchOptions = {}): SearchResult {
  const cells = grid.cols * grid.rows
  const open = (ref: CellRef) => grid.track[ref.layer]?.[ref.cell] === FREE
  const goals = targets.filter(open)
  const isGoal = new Uint8Array(grid.layers.length * cells)
  for (const { layer, cell } of goals) isGoal[layer * cells + cell] = 1
  const boxes = targetBoxes(grid, goals)
  const estimate = (layer: number, cell: number): number => {
    const [col, row] = [cell % grid.cols, Math.floor(cell / grid.cols)]
    return boxes.reduce((best, box, l) => (box === undefined ? best : Math.min(best, octile(box, col, row) + (l === layer ? 0 : VIA))), Infinity)
  }
  const states = grid.layers.length * cells * DIRECTIONS
  const cost = new Float64Array(states).fill(Infinity)
  const parent = new Int32Array(states).fill(-1)
  const closed = new Uint8Array(states)
  const queue = new Queue()
  const reach = (state: number, g: number, from: number, node: number): void => {
    if (g >= (cost[state] as number)) return
    cost[state] = g
    parent[state] = from
    const h = estimate(Math.floor(node / cells), node % cells)
    queue.push(g + h, h, state)
  }
  if (goals.length > 0) for (const ref of sources.filter(open)) reach((ref.layer * cells + ref.cell) * DIRECTIONS + NONE, 0, -1, ref.layer * cells + ref.cell)
  const limit = options.maxExpansions ?? DEFAULT_MAX_EXPANSIONS
  let expanded = 0
  while (queue.size > 0) {
    const state = queue.pop()
    if (closed[state] === 1) continue
    closed[state] = 1
    if (++expanded > limit) return { found: false, reason: "limit", expanded: limit, blockers: [] }
    const node = Math.floor(state / DIRECTIONS)
    if (isGoal[node] === 1) return { found: true, steps: stepsTo(parent, state, cells), cost: cost[state] as number }
    const g = cost[state] as number
    const [layer, cell, dir] = [Math.floor(node / cells), node % cells, state % DIRECTIONS]
    const [col, row] = [cell % grid.cols, Math.floor(cell / grid.cols)]
    const map = grid.track[layer] as Int32Array
    for (let d = 0; d < 8; d++) {
      const turn = turnOf(dir, d)
      if (turn > 2) continue
      const [c, r] = [col + (DCOL[d] as number), row + (DROW[d] as number)]
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows || map[r * grid.cols + c] !== FREE) continue
      const next = layer * cells + r * grid.cols + c
      reach(next * DIRECTIONS + d, g + (d % 2 === 1 ? DIAGONAL : STEP) + (TURN_COST[turn] as number), state, next)
    }
    if (grid.via[cell] !== FREE) continue
    for (let l = 0; l < grid.layers.length; l++) {
      if (l === layer || grid.track[l]?.[cell] !== FREE) continue
      reach((l * cells + cell) * DIRECTIONS + NONE, g + VIA, state, l * cells + cell)
    }
  }
  return { found: false, reason: "no-path", expanded, blockers: blockersAround(grid, closed) }
}

function stepsTo(parent: Int32Array, last: number, cells: number): CellRef[] {
  const steps: CellRef[] = []
  for (let state = last; state !== -1; state = parent[state] as number) {
    const node = Math.floor(state / DIRECTIONS)
    steps.push({ layer: Math.floor(node / cells), cell: node % cells })
  }
  return steps.reverse()
}
