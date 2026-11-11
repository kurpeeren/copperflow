import { BoxIndex, GRID, inArea, moved, snap, tooClose, type Box } from "./geometry.js"
import type { Movable, Problem } from "./scope.js"
import { copyState, NetModel, type State } from "./score.js"

/** Tries per part that moves, and the bounds on the whole run. */
const TRIES_PER_PART = 40
const MIN_TRIES = 400
const MAX_TRIES = 20_000
/** The clock is read once per this many tries. */
const CLOCK_EVERY = 32
/** The first temperature, as a share of the mean ratsnest line, and the last as a share of the first. */
const START_HEAT = 0.3
const END_HEAT = 1e-3
/** The first move reach, as a share of the area's larger side; it shrinks to one grid step. */
const START_REACH = 0.25
const SWAP_SHARE = 0.25
const MOVE_SHARE = 0.5
const DEFAULT_SEED = 1

export interface RefineOptions {
  /** The time the refinement may take, in ms; no limit by default. */
  budgetMs?: number
  /** The clock the budget is measured on, in ms (performance.now by default). */
  clock?: () => number
  /** The seed of the move sequence; the same seed gives the same moves. */
  seed?: number
}

export interface Refined {
  state: State
  /** The total ratsnest length before and after. */
  before: number
  after: number
  /** The best total after each improvement, starting with `before`: never rising. */
  trace: number[]
  tries: number
  budgetSpent: boolean
}

/** A 32-bit linear congruential generator (Numerical Recipes constants): the same seed, the same numbers in [0, 1). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/**
 * What moves together: a chip with the decoupling capacitors placed beside it is shifted as one, so they stay
 * beside its pins. Connectors stay on their edge, capacitors of fixed chips beside those chips, and parts that
 * found no room where they are.
 */
function unitsOf(problem: Problem, frozen: ReadonlySet<number>): number[][] {
  const names = new Map(problem.movables.map((m, i) => [m.name, i]))
  const caps = new Map<number, number[]>()
  problem.movables.forEach((m, i) => {
    const chip = m.decouples ? names.get(m.decouples.part) : undefined
    if (chip !== undefined && !frozen.has(chip)) caps.set(chip, [...(caps.get(chip) ?? []), i])
  })
  const grouped = new Set([...caps.values()].flat())
  return problem.movables.flatMap((m: Movable, i) => {
    if (frozen.has(i) || grouped.has(i) || m.role === "connector" || m.decouples) return []
    return [[i, ...(caps.get(i) ?? [])]]
  })
}

interface Move {
  parts: number[]
  x: number[]
  y: number[]
  rot: number[]
}

class Annealer {
  readonly index = new BoxIndex()
  readonly model: NetModel
  readonly netStamp: Int32Array
  stamp = 0

  constructor(
    readonly problem: Problem,
    readonly state: State,
  ) {
    problem.obstacles.forEach((o, k) => this.index.set(problem.movables.length + k, o.box))
    problem.movables.forEach((_, i) => this.index.set(i, this.boxOf(i, state.x[i] as number, state.y[i] as number, state.rot[i] as number)))
    this.model = new NetModel(problem)
    this.netStamp = new Int32Array(problem.nets.length)
  }

  boxOf(i: number, x: number, y: number, rot: number): Box {
    return moved((this.problem.movables[i] as Movable).boxes[rot] as Box, x, y)
  }

  /** Whether the parts of `move` fit where it puts them, clear of everything else and of each other. */
  fits(move: Move): boolean {
    const boxes = move.parts.map((i, k) => this.boxOf(i, move.x[k] as number, move.y[k] as number, move.rot[k] as number))
    const own = new Set(move.parts)
    const gap = this.problem.clearance
    for (const [k, box] of boxes.entries()) {
      if (!inArea(box, this.problem.area) || this.index.clashes(box, gap, (id) => own.has(id))) return false
      for (let j = k + 1; j < boxes.length; j++) if (tooClose(box, boxes[j] as Box, gap)) return false
    }
    return true
  }

  /** Applies `move` and returns the change in total length; `undo` reverses it. */
  apply(move: Move): { delta: number; undo: () => void } {
    const s = this.state
    const old = move.parts.map((i) => ({ x: s.x[i] as number, y: s.y[i] as number, rot: s.rot[i] as number }))
    this.stamp++
    const nets: number[] = []
    for (const i of move.parts) {
      for (const net of this.model.netsOf[i] ?? []) {
        if (this.netStamp[net] === this.stamp) continue
        this.netStamp[net] = this.stamp
        nets.push(net)
      }
    }
    const set = (values: readonly { x: number; y: number; rot: number }[]) =>
      move.parts.forEach((i, k) => {
        const v = values[k] as { x: number; y: number; rot: number }
        s.x[i] = v.x
        s.y[i] = v.y
        s.rot[i] = v.rot
        this.index.set(i, this.boxOf(i, v.x, v.y, v.rot))
      })
    set(move.parts.map((_, k) => ({ x: move.x[k] as number, y: move.y[k] as number, rot: move.rot[k] as number })))
    const lengths = this.model.lengths
    const before = nets.map((n) => lengths[n] as number)
    let delta = 0
    nets.forEach((n, k) => {
      const length = this.model.netLength(n, s)
      lengths[n] = length
      delta += length - (before[k] as number)
    })
    const undo = () => {
      set(old)
      nets.forEach((n, k) => (lengths[n] = before[k] as number))
    }
    return { delta, undo }
  }
}

/** Shift a unit, swap two single parts, or turn one: chosen by `random`, reaching at most `reach` mm. */
function propose(units: readonly number[][], s: State, random: () => number, reach: number): Move | undefined {
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)] as T
  const kind = random()
  const singles = units.filter((u) => u.length === 1)
  if (kind < MOVE_SHARE) {
    const unit = pick(units)
    const dx = snap((random() * 2 - 1) * reach)
    const dy = snap((random() * 2 - 1) * reach)
    if (dx === 0 && dy === 0) return undefined
    return { parts: unit, x: unit.map((i) => (s.x[i] as number) + dx), y: unit.map((i) => (s.y[i] as number) + dy), rot: unit.map((i) => s.rot[i] as number) }
  }
  if (kind < MOVE_SHARE + SWAP_SHARE) {
    if (singles.length < 2) return undefined
    const a = (pick(singles) as number[])[0] as number
    const b = (pick(singles) as number[])[0] as number
    if (a === b) return undefined
    return { parts: [a, b], x: [s.x[b] as number, s.x[a] as number], y: [s.y[b] as number, s.y[a] as number], rot: [s.rot[a] as number, s.rot[b] as number] }
  }
  if (singles.length === 0) return undefined
  const i = (pick(singles) as number[])[0] as number
  const turn = 1 + Math.floor(random() * 3)
  return { parts: [i], x: [s.x[i] as number], y: [s.y[i] as number], rot: [((s.rot[i] as number) + turn) & 3] }
}

/**
 * Simulated annealing on the total ratsnest length with a fixed schedule: a fixed number of tries for the number of
 * parts, the temperature and the move reach falling geometrically, the moves drawn from a seeded generator, so the
 * same input gives the same result. A change that shortens the total is always kept; a longer one sometimes, early
 * on. The best state seen is returned, so the result is never longer than the start. Parts in `frozen` stay.
 */
export function refine(problem: Problem, start: State, frozen: ReadonlySet<number>, options: RefineOptions = {}): Refined {
  const state = copyState(start)
  const annealer = new Annealer(problem, state)
  const before = annealer.model.measure(state)
  const units = unitsOf(problem, frozen)
  const tries = units.length === 0 ? 0 : Math.min(MAX_TRIES, Math.max(MIN_TRIES, TRIES_PER_PART * units.length))
  const random = lcg(options.seed ?? DEFAULT_SEED)
  const clock = options.clock ?? (() => performance.now())
  const began = clock()
  const lines = problem.nets.reduce((sum, _, n) => sum + Math.max(0, (annealer.model.members[n]?.length ?? 0) + (problem.fixedPads[n]?.length ?? 0) - 1), 0)
  const heat0 = (START_HEAT * before) / Math.max(1, lines)
  const area = problem.area.box
  const reach0 = Math.max(GRID, START_REACH * Math.max(area.maxX - area.minX, area.maxY - area.minY))
  let current = before
  let best = { total: before, state: copyState(state) }
  const trace = [before]
  let done = 0
  let budgetSpent = false
  for (; done < tries; done++) {
    if (options.budgetMs !== undefined && done % CLOCK_EVERY === 0 && clock() - began >= options.budgetMs) {
      budgetSpent = true
      break
    }
    const progress = done / tries
    const heat = heat0 * END_HEAT ** progress
    const reach = Math.max(GRID, reach0 * (GRID / reach0) ** progress)
    const move = propose(units, state, random, reach)
    if (!move || !annealer.fits(move)) continue
    const { delta, undo } = annealer.apply(move)
    const keep = delta < 0 || (heat > 0 && random() < Math.exp(-delta / heat))
    if (!keep) {
      undo()
      continue
    }
    current += delta
    if (current < best.total - 1e-9) {
      best = { total: current, state: copyState(state) }
      trace.push(current)
    }
  }
  // The running total drifts by rounding; the best state is measured afresh (the start measures as `before` again).
  const after = new NetModel(problem).measure(best.state)
  return { state: best.state, before, after, trace, tries: done, budgetSpent }
}
