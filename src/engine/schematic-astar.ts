// A* on a LocalGrid: the shortest orthogonal path from any SOURCE point to any TARGET point,
// where a step costs 1, a bend costs BEND_COST more and crossing another net's wire CROSS_COST
// more. The heap and the order of the moves are fixed, so the same sheet always gives the same wires.
import { BLOCK, CROSS, EDGE_EAST, EDGE_NORTH, SOURCE, TARGET, type CellRect, type LocalGrid } from "./schematic-grid.js"

/** A bend costs as much as two steps. */
const BEND_COST = 2
/** Crossing another net's wire costs as much as two steps, so wires cross only to save a detour. */
const CROSS_COST = 2
const OWN = SOURCE | TARGET
/** Among equal estimates the state nearer the target comes first; the distance left is kept below this. */
const LEFT_SPAN = 1 << 16
/** East, north, west, south. */
const DX = [1, 0, -1, 0] as const
const DY = [0, 1, 0, -1] as const

/** A binary min-heap of search states keyed by one number: the estimate, then the distance left. */
class StateHeap {
  private keys = new Float64Array(1024)
  private states = new Int32Array(1024)
  size = 0

  clear(): void {
    this.size = 0
  }

  push(state: number, estimate: number, left: number): void {
    if (this.size === this.states.length) this.grow()
    const key = estimate * LEFT_SPAN + Math.min(left, LEFT_SPAN - 1)
    let i = this.size++
    while (i > 0) {
      const up = (i - 1) >> 1
      if ((this.keys[up] as number) <= key) break
      this.keys[i] = this.keys[up] as number
      this.states[i] = this.states[up] as number
      i = up
    }
    this.keys[i] = key
    this.states[i] = state
  }

  /** Removes and returns the state with the smallest key. */
  pop(): number {
    const top = this.states[0] as number
    const last = --this.size
    const key = this.keys[last] as number
    const state = this.states[last] as number
    let i = 0
    for (let child = 1; child < last; child = i * 2 + 1) {
      if (child + 1 < last && (this.keys[child + 1] as number) < (this.keys[child] as number)) child += 1
      if ((this.keys[child] as number) >= key) break
      this.keys[i] = this.keys[child] as number
      this.states[i] = this.states[child] as number
      i = child
    }
    this.keys[i] = key
    this.states[i] = state
    return top
  }

  private grow(): void {
    const keys = new Float64Array(this.keys.length * 2)
    const states = new Int32Array(this.states.length * 2)
    keys.set(this.keys)
    states.set(this.states)
    this.keys = keys
    this.states = states
  }
}

/** Buffers one layout reuses for every search; a stamp marks which entries belong to the current search. */
export class SearchScratch {
  flags = new Uint8Array(0)
  costs = new Int32Array(0)
  parents = new Int32Array(0)
  stamps = new Uint32Array(0)
  /** States already expanded in the current search carry its stamp. */
  closed = new Uint32Array(0)
  stamp = 0
  readonly heap = new StateHeap()

  /** Room for `cells` grid points; returns the flag buffer. */
  reserve(cells: number): Uint8Array {
    if (this.flags.length < cells) {
      const size = Math.max(cells, this.flags.length * 2)
      this.flags = new Uint8Array(size)
      this.costs = new Int32Array(size * 4)
      this.parents = new Int32Array(size * 4)
      this.stamps = new Uint32Array(size * 4)
      this.closed = new Uint32Array(size * 4)
      this.stamp = 0
    }
    this.stamp += 1
    this.heap.clear()
    return this.flags
  }
}

/** Steps plus one bend when both axes still differ: never more than the real cost. */
function distanceLeft(goal: CellRect, x: number, y: number): number {
  const dx = x < goal.minX ? goal.minX - x : x > goal.maxX ? x - goal.maxX : 0
  const dy = y < goal.minY ? goal.minY - y : y > goal.maxY ? y - goal.maxY : 0
  return dx + dy + (dx > 0 && dy > 0 ? BEND_COST : 0)
}

/** Whether the edge from `index` one step in `direction` to `next` is free of other wires. */
function edgeFree(flags: Uint8Array, index: number, next: number, direction: number): boolean {
  if (direction === 0) return ((flags[index] as number) & EDGE_EAST) === 0
  if (direction === 2) return ((flags[next] as number) & EDGE_EAST) === 0
  if (direction === 1) return ((flags[index] as number) & EDGE_NORTH) === 0
  return ((flags[next] as number) & EDGE_NORTH) === 0
}

/** The cost of stepping into `next`, or -1 when it cannot be entered. */
function stepCost(flags: Uint8Array, next: number, bend: boolean): number {
  const flag = flags[next] as number
  const base = bend ? 1 + BEND_COST : 1
  if (flag & OWN) return base
  if (flag & BLOCK) return -1
  return flag & CROSS ? base + CROSS_COST : base
}

/** The path's grid indices from source to target, by following the parents back. */
function pathTo(scratch: SearchScratch, state: number): number[] {
  const cells: number[] = []
  for (let at = state; at >= 0; at = scratch.parents[at] as number) cells.push(at >> 2)
  return cells.reverse()
}

/** Relaxes the step from state `from` into `next`; a wire leaving a source may set off in any direction without a bend. */
function relax(grid: LocalGrid, scratch: SearchScratch, from: number, next: number, nextDirection: number, setOff: boolean): void {
  if (!edgeFree(grid.flags, from >> 2, next, nextDirection)) return
  const step = stepCost(grid.flags, next, !setOff && nextDirection !== (from & 3))
  if (step < 0) return
  const state = (next << 2) | nextDirection
  const total = (scratch.costs[from] as number) + step
  if (scratch.stamps[state] === scratch.stamp && (scratch.costs[state] as number) <= total) return
  scratch.stamps[state] = scratch.stamp
  scratch.costs[state] = total
  scratch.parents[state] = from
  const nx = next % grid.width
  const left = distanceLeft(grid.goal, nx, (next - nx) / grid.width)
  scratch.heap.push(state, total + left, left)
}

function expand(grid: LocalGrid, scratch: SearchScratch, state: number): void {
  const index = state >> 2
  const direction = state & 3
  const flag = grid.flags[index] as number
  const crossing = (flag & CROSS) !== 0 && (flag & OWN) === 0
  const setOff = (flag & SOURCE) !== 0 && scratch.costs[state] === 0
  const { width, height } = grid
  const x = index % width
  const y = (index - x) / width
  for (let next = 0; next < 4; next++) {
    if ((!setOff && next === ((direction + 2) & 3)) || (crossing && next !== direction)) continue
    const nx = x + (DX[next] as number)
    const ny = y + (DY[next] as number)
    if (nx >= 0 && ny >= 0 && nx < width && ny < height) relax(grid, scratch, state, ny * width + nx, next, setOff)
  }
}

/** One state per source, with no direction yet: its first step may go any way. */
function seed(grid: LocalGrid, scratch: SearchScratch): void {
  for (const index of grid.sources) {
    const left = distanceLeft(grid.goal, index % grid.width, Math.floor(index / grid.width))
    const state = index << 2
    scratch.stamps[state] = scratch.stamp
    scratch.costs[state] = 0
    scratch.parents[state] = -1
    scratch.heap.push(state, left, left)
  }
}

/** The cheapest path from a SOURCE to a TARGET as local grid indices, or undefined when none exists in the box. */
export function findPath(grid: LocalGrid, scratch: SearchScratch): number[] | undefined {
  if (grid.sources.length === 0 || grid.goal.minX > grid.goal.maxX) return undefined
  seed(grid, scratch)
  while (scratch.heap.size > 0) {
    const state = scratch.heap.pop()
    if (scratch.closed[state] === scratch.stamp) continue
    scratch.closed[state] = scratch.stamp
    if ((grid.flags[state >> 2] as number) & TARGET) return pathTo(scratch, state)
    expand(grid, scratch, state)
  }
  return undefined
}
