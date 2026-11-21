import type { Point } from "../model.js"
import { construct, OUT_OF_TIME, type Constructed } from "./constructive.js"
import type { Box } from "./geometry.js"
import type { Problem } from "./scope.js"
import { NetModel, type State } from "./score.js"

/** Packing is tried on boards of at most this many parts to place: its spot search grows with the cube of the count. */
export const PACK_MOST_PARTS = 60
/** Orders tried at most: the largest parts first, then shuffles of it. */
const PACK_TRIES = 64
/** The weights on contact the tries take in turn (mm of wire per mm of side against a wall or courtyard). */
const PACK_WEIGHTS = [2, 8]
/** The shuffles' seed: the same board packs the same way every time. */
const SEED = 7
const MODULUS = 2147483647
const MULTIPLIER = 16807

/** What packing gave: the constructive pass and the state it filled. */
export interface Packed {
  built: Constructed
  state: State
}

const area = (b: Box): number => (b.maxX - b.minX) * (b.maxY - b.minY)
const copy = (s: State): State => ({ x: s.x.slice(), y: s.y.slice(), rot: s.rot.slice() })

/** The orders to try: the largest courtyard first, then seeded shuffles; connectors always last, for the edges. */
function* orders(problem: Problem): Generator<number[]> {
  const indexes = problem.movables.map((_, i) => i)
  const last = (i: number) => (problem.movables[i]?.role === "connector" ? 1 : 0)
  const size = (i: number) => area(problem.movables[i]?.boxes[0] as Box)
  const largest = [...indexes].sort((a, b) => last(a) - last(b) || size(b) - size(a) || a - b)
  yield largest
  let seed = SEED
  const next = () => (seed = (seed * MULTIPLIER) % MODULUS) / MODULUS
  for (let k = 1; k < PACK_TRIES; k++) {
    const keys = indexes.map(() => next())
    yield [...indexes].sort((a, b) => last(a) - last(b) || (keys[a] as number) - (keys[b] as number) || a - b)
  }
}

/**
 * For a crowded board where the constructive pass left parts with no room: the parts placed again from `start`,
 * packed against the walls and each other, in one order after another until one places them all or the time is up.
 * The parts in `first` go first, each on the edge it names across from its point. The pass that leaves fewest
 * unplaced (then least wire) is returned, or undefined when it is not better than `unplaced` parts left, or the board
 * has too many parts to pack.
 */
export function packTight(problem: Problem, start: State, unplaced: number, late: () => boolean, first?: ReadonlyMap<number, Point>): Packed | undefined {
  if (problem.movables.length > PACK_MOST_PARTS) return undefined
  const model = new NetModel(problem)
  let best: (Packed & { wire: number }) | undefined
  let k = 0
  for (const order of orders(problem)) {
    if (late()) break
    const state = copy(start)
    const built = construct(problem, state, late, undefined, false, first, { order, weight: PACK_WEIGHTS[k++ % PACK_WEIGHTS.length] as number })
    if (built.unplaced.some((u) => u.reason === OUT_OF_TIME)) break
    const wire = model.measure(state)
    const fewer = !best || built.unplaced.length < best.built.unplaced.length
    if (fewer || (built.unplaced.length === best?.built.unplaced.length && wire < best.wire - 1e-9)) best = { built, state, wire }
    if (built.unplaced.length === 0) break
  }
  return best && best.built.unplaced.length < unplaced ? { built: best.built, state: best.state } : undefined
}
