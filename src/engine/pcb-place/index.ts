import type { Design } from "../design.js"
import { construct } from "./constructive.js"
import { EPSILON, ROTATIONS } from "./geometry.js"
import { refine, type RefineOptions } from "./refine.js"
import { readProblem, type ScopeOptions } from "./scope.js"
import { edgeTouches, NetModel, ratsnestLength, type State } from "./score.js"

export { fitBoard, type FitBoard } from "./fit-board.js"
export type { PlaceScope } from "./scope.js"

export interface PlaceOptions extends ScopeOptions, RefineOptions {
  /** Whether to run the refinement after the constructive pass; true by default. */
  refine?: boolean
}

/** A part's centre on the board (mm, the groups' offsets included) and its rotation in degrees. */
export interface PlacedPosition {
  x: number
  y: number
  rotation: number
}

export interface Placement {
  /** Where each part the placer was given goes. */
  positions: Map<string, PlacedPosition>
  /** The total ratsnest length after placement (copper ignored), and the parts touching the edge clearance. */
  score: { wireLength: number; edgeTouches: number }
  /** The total ratsnest length with the parts where the build put them. */
  before: { wireLength: number }
  /** The parts whose position or rotation changed, in natural order. */
  moved: string[]
  /** The parts no free spot could take: they stay where the build put them. */
  unplaced: string[]
  /** Whether the refinement stopped at its time budget. */
  budgetSpent: boolean
}

/** Positions are given to the micrometre: the steps the placer takes leave float noise below that. */
const tidy = (v: number): number => Math.round(v * 1e6) / 1e6
const quarterOf = (rotation: number): number => Math.round(rotation / 90) & 3

/**
 * Places the parts nobody placed or locked (in the scope) by connectivity: a constructive pass (the chip with most
 * connections first, each next part at the spot that costs least wire, decoupling capacitors beside their supply
 * pins, connectors on the nearest edge with their pins inward), then simulated annealing on the total ratsnest length.
 * Pure: it reads the design and returns positions; writing them is the caller's. Same input, same output.
 */
export function placeBoard(design: Design, options: PlaceOptions = {}): Placement {
  const problem = readProblem(design, options)
  const n = problem.movables.length
  const start: State = {
    x: Float64Array.from(problem.movables, (m) => m.start.x),
    y: Float64Array.from(problem.movables, (m) => m.start.y),
    rot: Uint8Array.from(problem.movables, (m) => quarterOf(m.start.rotation)),
  }
  const { unplaced } = construct(problem, start)
  const frozen = new Set(unplaced)
  const refined = options.refine === false ? undefined : refine(problem, start, frozen, options)
  const final = refined?.state ?? start
  const positions = new Map<string, PlacedPosition>()
  const moved: string[] = []
  for (let i = 0; i < n; i++) {
    const m = problem.movables[i] as (typeof problem.movables)[number]
    const at = frozen.has(i) ? m.start : { x: tidy(final.x[i] as number), y: tidy(final.y[i] as number), rotation: ROTATIONS[final.rot[i] as number] as number }
    positions.set(m.name, at)
    const same = Math.abs(at.x - m.start.x) < EPSILON && Math.abs(at.y - m.start.y) < EPSILON && at.rotation === m.start.rotation
    if (!same) moved.push(m.name)
  }
  return {
    positions,
    score: { wireLength: refined?.after ?? new NetModel(problem).measure(final), edgeTouches: edgeTouches(problem, final) },
    before: { wireLength: ratsnestLength(design.pcb.parts) },
    moved,
    unplaced: unplaced.map((i) => problem.movables[i]?.name as string),
    budgetSpent: refined?.budgetSpent ?? false,
  }
}
