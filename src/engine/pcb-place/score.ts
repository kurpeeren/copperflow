import type { Point } from "../model.js"
import type { PlacedFootprint } from "../pcb.js"
import { EPSILON, moved, type Area, type Box } from "./geometry.js"
import type { Problem } from "./scope.js"

/** Where each movable part is: centre and rotation index, by its index in `Problem.movables`. */
export interface State {
  x: Float64Array
  y: Float64Array
  rot: Uint8Array
}

export const copyState = (s: State): State => ({ x: Float64Array.from(s.x), y: Float64Array.from(s.y), rot: Uint8Array.from(s.rot) })

export const boxIn = (problem: Problem, s: State, i: number): Box => {
  const m = problem.movables[i]
  if (!m) throw new Error(`no movable part ${i}`)
  return moved(m.boxes[s.rot[i] as number] as Box, s.x[i] as number, s.y[i] as number)
}

/**
 * The length of the minimum spanning tree over `n` points by centre distance (Prim's, one pass over the points left
 * per step): the ratsnest of one net when no copper joins its pads.
 */
export function treeLength(xs: Float64Array, ys: Float64Array, n: number, best: Float64Array): number {
  if (n < 2) return 0
  // The tree is built on squared distances, which order the edges the same; only the chosen edges take a root.
  best.fill(Infinity, 0, n)
  let total = 0
  let current = 0
  best[0] = -1
  for (let step = 1; step < n; step++) {
    const cx = xs[current] as number
    const cy = ys[current] as number
    let next = -1
    let nextD = Infinity
    for (let j = 0; j < n; j++) {
      const bj = best[j] as number
      if (bj < 0) continue
      const dx = (xs[j] as number) - cx
      const dy = (ys[j] as number) - cy
      const d = dx * dx + dy * dy
      const b = d < bj ? d : bj
      best[j] = b
      if (b < nextD) {
        nextD = b
        next = j
      }
    }
    total += Math.sqrt(nextD)
    current = next
    best[next] = -1
  }
  return total
}

/** The pads of every net: movable ones as (part, pad) pairs, fixed ones as points; and the nets each part touches. */
export class NetModel {
  readonly members: { part: number; pad: number }[][]
  readonly netsOf: number[][]
  private readonly xs: Float64Array
  private readonly ys: Float64Array
  private readonly best: Float64Array
  readonly lengths: Float64Array

  constructor(private readonly problem: Problem) {
    this.members = problem.nets.map(() => [])
    this.netsOf = problem.movables.map(() => [])
    problem.movables.forEach((m, part) => {
      ;(m.pads[0] ?? []).forEach((pad, i) => {
        if (pad.net < 0) return
        this.members[pad.net]?.push({ part, pad: i })
        const own = this.netsOf[part] as number[]
        if (!own.includes(pad.net)) own.push(pad.net)
      })
    })
    const largest = Math.max(1, ...problem.nets.map((_, n) => (this.members[n]?.length ?? 0) + (problem.fixedPads[n]?.length ?? 0)))
    this.xs = new Float64Array(largest)
    this.ys = new Float64Array(largest)
    this.best = new Float64Array(largest)
    this.lengths = new Float64Array(problem.nets.length)
  }

  /** The ratsnest length of one net with the movable parts where `s` puts them. */
  netLength(net: number, s: State): number {
    let n = 0
    for (const { part, pad } of this.members[net] ?? []) {
      const p = this.problem.movables[part]?.pads[s.rot[part] as number]?.[pad] as Point
      this.xs[n] = (s.x[part] as number) + p.x
      this.ys[n] = (s.y[part] as number) + p.y
      n++
    }
    for (const p of this.problem.fixedPads[net] ?? []) {
      this.xs[n] = p.x
      this.ys[n] = p.y
      n++
    }
    return treeLength(this.xs, this.ys, n, this.best)
  }

  /** Measures every net into `lengths` and returns the sum. */
  measure(s: State): number {
    let total = 0
    for (let net = 0; net < this.lengths.length; net++) {
      const length = this.netLength(net, s)
      this.lengths[net] = length
      total += length
    }
    return total
  }
}

/** The total ratsnest length of the parts as the build placed them (copper ignored), in mm. */
export function ratsnestLength(parts: readonly PlacedFootprint[]): number {
  const nets = new Map<string, Point[]>()
  for (const part of parts) {
    for (const pad of part.pads) {
      if (pad.net === undefined) continue
      const list = nets.get(pad.net)
      if (list) list.push(pad)
      else nets.set(pad.net, [pad])
    }
  }
  const largest = Math.max(1, ...[...nets.values()].map((pads) => pads.length))
  const [xs, ys, best] = [new Float64Array(largest), new Float64Array(largest), new Float64Array(largest)]
  let total = 0
  for (const pads of nets.values()) {
    pads.forEach((p, i) => {
      xs[i] = p.x
      ys[i] = p.y
    })
    total += treeLength(xs, ys, pads.length, best)
  }
  return total
}

/** Whether a courtyard touches the edge of the area (the outline less the edge clearance). */
export function touchesEdge(b: Box, area: Area): boolean {
  const a = area.box
  return b.minX <= a.minX + EPSILON || b.maxX >= a.maxX - EPSILON || b.minY <= a.minY + EPSILON || b.maxY >= a.maxY - EPSILON
}

/** How many parts, moved or not, touch the edge clearance. */
export function edgeTouches(problem: Problem, s: State): number {
  const moving = problem.movables.filter((_, i) => touchesEdge(boxIn(problem, s, i), problem.area)).length
  const staying = problem.obstacles.filter((o) => o.part && touchesEdge(o.box, problem.area)).length
  return moving + staying
}
