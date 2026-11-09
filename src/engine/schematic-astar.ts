// A* on a window of the SheetGrid: the shortest orthogonal path from any SOURCE point to any
// TARGET point, where a step costs 1, a bend BEND_COST more and crossing another net's wire
// CROSS_COST more. A state is a grid point and the axis the wire runs along there, so a bend is a
// change of axis. The estimate h is the distance to the targets' box plus one bend when the state's
// axis cannot get there without turning. h never drops by more than a move costs (the bend term
// only goes away on a turn, which pays a bend), so it is consistent.
//
// An exact search takes states in the order of g + h, so the first time a state is taken it is at
// its cheapest and no state needs reopening. A weighted search takes them in the order of
// g + (5/4)h: a wire that has to go round symbols at both ends otherwise makes A* take nearly
// every point between its pins. With a consistent h, weighted A* that never reopens a state
// returns a path costing at most 5/4 of the cheapest (Likhachev, Gordon and Thrun, "ARA*", 2003),
// so states are not reopened there either. The queue and the order of the moves are fixed, so the
// same sheet always gives the same wires. A search gives up after `maxExpansions` states.
import { BLOCK, CROSS, EDGE_EAST, EDGE_NORTH, PASS, SOURCE, SYMBOL, TARGET, type CellRect, type SheetGrid } from "./schematic-grid.js"

/** A bend costs as much as two steps. */
const BEND_COST = 2
/** Crossing another net's wire costs as much as two steps, so wires cross only to save a detour. */
const CROSS_COST = 2
const OWN = SOURCE | TARGET | PASS
const CLOSED = BLOCK | SYMBOL
/** A weighted search's order key is 4g + 5h, whole numbers for the queue: h weighs 5/4. */
const WEIGHTED = { g: 4, h: 5 } as const
const EXACT = { g: 1, h: 1 } as const
/** East, north, west, south; a move along x keeps axis 0, along y axis 1. */
const DX = [1, 0, -1, 0] as const
const DY = [0, 1, 0, -1] as const

/** States by key: one stack per whole-number key, taken from the lowest; within one key the latest state comes first. */
class BucketQueue {
  private readonly buckets: number[][] = []
  private lowest = 0
  private highest = -1
  size = 0

  clear(): void {
    for (let i = this.lowest; i <= this.highest; i++) (this.buckets[i] as number[]).length = 0
    this.lowest = 0
    this.highest = -1
    this.size = 0
  }

  push(state: number, estimate: number): void {
    while (this.buckets.length <= estimate) this.buckets.push([])
    ;(this.buckets[estimate] as number[]).push(state)
    if (this.size === 0 || estimate < this.lowest) this.lowest = estimate
    if (estimate > this.highest) this.highest = estimate
    this.size += 1
  }

  /** Removes and returns a state with the lowest estimate. */
  pop(): number {
    while ((this.buckets[this.lowest] as number[]).length === 0) this.lowest += 1
    this.size -= 1
    return (this.buckets[this.lowest] as number[]).pop() as number
  }
}

/** Buffers one layout reuses for every search; a stamp marks which entries belong to the current search. */
export class SearchScratch {
  costs = new Int32Array(0)
  parents = new Int32Array(0)
  stamps = new Uint32Array(0)
  /** States already expanded in the current search carry its stamp. */
  closed = new Uint32Array(0)
  stamp = 0
  readonly queue = new BucketQueue()

  /** Room for `cells` grid points in the next search. */
  reserve(cells: number): void {
    if (this.costs.length < cells * 2) {
      const size = Math.max(cells * 2, this.costs.length * 2)
      this.costs = new Int32Array(size)
      this.parents = new Int32Array(size)
      this.stamps = new Uint32Array(size)
      this.closed = new Uint32Array(size)
      this.stamp = 0
    }
    this.stamp += 1
    this.queue.clear()
  }
}

/** One search: a box of the sheet grid, its sources as box indices and its targets' extent in box cells. */
export interface Window {
  grid: SheetGrid
  box: CellRect
  sources: readonly number[]
  goal: CellRect
  maxExpansions: number
  /** Whether h weighs 5/4: a path at most 5/4 of the cheapest, found with far fewer states. */
  weighted: boolean
}

/** A window resolved into what the inner loop reads. */
interface Search {
  flags: Uint8Array
  /** The flag index of the box's first cell, and the flag row length. */
  offset: number
  stride: number
  width: number
  height: number
  goal: CellRect
  scratch: SearchScratch
  weights: typeof EXACT | typeof WEIGHTED
}

/** Whether a wire running along `axis` (0 across, 1 up and down, -1 not set off yet) must still turn to reach the targets' box. */
function mustTurn(goal: CellRect, x: number, y: number, axis: number): boolean {
  const acrossX = x < goal.minX || x > goal.maxX
  const acrossY = y < goal.minY || y > goal.maxY
  if (acrossX && acrossY) return true
  if (axis < 0) return false
  return (acrossX && axis === 1) || (acrossY && axis === 0)
}

/** Steps to the targets' box, plus a bend when one is still needed: never more than the real cost, and consistent. */
function distanceLeft(goal: CellRect, x: number, y: number, axis: number): number {
  const dx = x < goal.minX ? goal.minX - x : x > goal.maxX ? x - goal.maxX : 0
  const dy = y < goal.minY ? goal.minY - y : y > goal.maxY ? y - goal.maxY : 0
  return dx + dy + (mustTurn(goal, x, y, axis) ? BEND_COST : 0)
}

/** Whether the edge between two flag indices is free: no wire runs along it, or both ends are on the wires joined to the routed pins. */
function edgeFree(flags: Uint8Array, from: number, to: number, direction: number): boolean {
  const owner = direction < 2 ? from : to
  const bit = (direction & 1) === 0 ? EDGE_EAST : EDGE_NORTH
  if (((flags[owner] as number) & bit) === 0) return true
  return ((flags[from] as number) & OWN) !== 0 && ((flags[to] as number) & OWN) !== 0
}

/** The cost of stepping into flag index `next`, or -1 when it cannot be entered. */
function stepCost(flags: Uint8Array, next: number, bend: boolean): number {
  const flag = flags[next] as number
  const base = bend ? 1 + BEND_COST : 1
  if (flag & OWN) return base
  if (flag & CLOSED) return -1
  return flag & CROSS ? base + CROSS_COST : base
}

/** The path's box indices from source to target, by following the parents back. */
function pathTo(scratch: SearchScratch, state: number): number[] {
  const cells: number[] = []
  for (let at = state; at >= 0; at = scratch.parents[at] as number) cells.push(at >> 1)
  return cells.reverse()
}

function relax(search: Search, from: number, fromFlag: number, x: number, y: number, direction: number, setOff: boolean): void {
  const { flags, scratch } = search
  const nextFlag = search.offset + y * search.stride + x
  if (!edgeFree(flags, fromFlag, nextFlag, direction)) return
  const axis = direction & 1
  const step = stepCost(flags, nextFlag, !setOff && axis !== (from & 1))
  if (step < 0) return
  const state = ((y * search.width + x) << 1) | axis
  const total = (scratch.costs[from] as number) + step
  if (scratch.stamps[state] === scratch.stamp && (scratch.costs[state] as number) <= total) return
  scratch.stamps[state] = scratch.stamp
  scratch.costs[state] = total
  scratch.parents[state] = from
  scratch.queue.push(state, search.weights.g * total + search.weights.h * distanceLeft(search.goal, x, y, axis))
}

function expand(search: Search, state: number): void {
  const index = state >> 1
  const axis = state & 1
  const x = index % search.width
  const y = (index - x) / search.width
  const fromFlag = search.offset + y * search.stride + x
  const flag = search.flags[fromFlag] as number
  const crossing = (flag & CROSS) !== 0 && (flag & OWN) === 0
  const setOff = (flag & SOURCE) !== 0 && search.scratch.costs[state] === 0
  for (let next = 0; next < 4; next++) {
    if (crossing && (next & 1) !== axis) continue
    const nx = x + (DX[next] as number)
    const ny = y + (DY[next] as number)
    if (nx >= 0 && ny >= 0 && nx < search.width && ny < search.height) relax(search, state, fromFlag, nx, ny, next, setOff)
  }
}

/** One state per source, not set off yet: its first step may go any way without a bend. */
function seed(search: Search, sources: readonly number[]): void {
  const { scratch } = search
  for (const index of sources) {
    const x = index % search.width
    const state = index << 1
    scratch.stamps[state] = scratch.stamp
    scratch.costs[state] = 0
    scratch.parents[state] = -1
    scratch.queue.push(state, search.weights.h * distanceLeft(search.goal, x, (index - x) / search.width, -1))
  }
}

function searchOf(window: Window, scratch: SearchScratch): Search {
  const { grid, box } = window
  const [width, height] = [box.maxX - box.minX + 1, box.maxY - box.minY + 1]
  scratch.reserve(width * height)
  const offset = (box.minY - grid.box.minY) * grid.width + (box.minX - grid.box.minX)
  const weights = window.weighted ? WEIGHTED : EXACT
  return { flags: grid.flags, offset, stride: grid.width, width, height, goal: window.goal, scratch, weights }
}

/** The cheapest path from a SOURCE to a TARGET as box indices (at most 5/4 of it when weighted); undefined when none exists in the box or the search runs past its cap. */
export function findPath(window: Window, scratch: SearchScratch): number[] | undefined {
  if (window.sources.length === 0 || window.goal.minX > window.goal.maxX) return undefined
  const search = searchOf(window, scratch)
  seed(search, window.sources)
  let expanded = 0
  while (scratch.queue.size > 0) {
    const state = scratch.queue.pop()
    if (scratch.closed[state] === scratch.stamp) continue
    scratch.closed[state] = scratch.stamp
    const index = state >> 1
    const x = index % search.width
    const flagIndex = search.offset + ((index - x) / search.width) * search.stride + x
    if ((search.flags[flagIndex] as number) & TARGET) return pathTo(scratch, state)
    if (++expanded > window.maxExpansions) return undefined
    expand(search, state)
  }
  return undefined
}
