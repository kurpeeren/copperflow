import type { Design } from "../design.js"
import { planCopies, placeCopies, type BlockMove } from "./blocks.js"
import { construct, OUT_OF_TIME } from "./constructive.js"
import { EPSILON, ROTATIONS } from "./geometry.js"
import { refine, type RefineOptions } from "./refine.js"
import { readProblem, type Problem, type ScopeOptions } from "./scope.js"
import { edgeTouches, NetModel, ratsnestLength, type State } from "./score.js"

export { DEFAULT_FIT_MARGIN, fitBoard, type FitBoard } from "./fit-board.js"
export type { PlaceScope } from "./scope.js"
export type { BlockMove } from "./blocks.js"

/** How far a placement is: parts done in the constructive pass, or tries made in the refinement, of the planned. */
export interface PlaceProgress {
  stage: "construct" | "refine"
  done: number
  total: number
}

export interface PlaceOptions extends ScopeOptions, Omit<RefineOptions, "budgetMs" | "onTries"> {
  /** Whether to run the refinement after the constructive pass; true by default. */
  refine?: boolean
  /**
   * The time the whole placement may take, in ms, measured on `clock`: the constructive pass places no part once it
   * is spent (those left are unplaced, "out of time"), and the refinement gets what is left. No limit by default.
   */
  budgetMs?: number
  /** Told as the placement goes (it does not change the result); a throw from it stops the placement. */
  onProgress?: (progress: PlaceProgress) => void
}

/**
 * A part's centre on the board and its rotation in degrees, both on the board as a whole: a sub-sheet instance's (or
 * group's) offset and rotation are included, so writing it as the part's pcbX/pcbY/pcbRotation means taking those
 * back out.
 */
export interface PlacedPosition {
  x: number
  y: number
  rotation: number
}

/** A part the placer could not place, and why; it stays auto-placed, so the build packs it round the placed ones. */
export interface UnplacedPart {
  name: string
  reason: string
}

export interface Placement {
  /** Where each placed part goes; the unplaced parts are not in it. */
  positions: Map<string, PlacedPosition>
  /** The other instances of a sheet whose first instance was placed, each moved as a whole by its anchor. */
  blocks: BlockMove[]
  /**
   * The total ratsnest length after placement (copper ignored; an unplaced part counted at the build's spot), and the
   * placed or fixed parts touching the edge clearance.
   */
  score: { wireLength: number; edgeTouches: number }
  /** The total ratsnest length with the parts where the build put them. */
  before: { wireLength: number }
  /** The parts in `positions` whose position or rotation differs from the build's, in natural order. */
  moved: string[]
  /** The parts no free spot (or no time) was left for, in placement order, with the reason. */
  unplaced: UnplacedPart[]
  /** What else the caller should know, such as a connector no board edge had room for. */
  notes: string[]
  /** Whether the time budget ran out, in the constructive pass or the refinement. */
  budgetSpent: boolean
}

/** A net with more pads than this (ground, a supply) is not one of a connector's own nets. */
const CONNECTOR_NET = 8

/** The ratsnest length of the small nets that reach a connector, with the parts where `s` puts them. */
function connectorWire(problem: Problem, s: State): number {
  const model = new NetModel(problem)
  const nets = new Set(problem.movables.flatMap((m) => (m.role === "connector" ? (m.pads[0] ?? []).map((p) => p.net) : [])))
  let total = 0
  for (const net of nets) if (net >= 0 && (model.members[net]?.length ?? 0) + (problem.fixedPads[net]?.length ?? 0) <= CONNECTOR_NET) total += model.netLength(net, s)
  return total
}

/** Positions are given to the micrometre: the steps the placer takes leave float noise below that. */
const tidy = (v: number): number => Math.round(v * 1e6) / 1e6
const quarterOf = (rotation: number): number => Math.round(rotation / 90) & 3

/**
 * Places the parts nobody placed or locked (in the scope) by connectivity: a constructive pass (the chip with most
 * connections first, each next part at the spot that costs least wire, decoupling capacitors beside their supply
 * pins and every other two-pin part a chip's net ties it to beside that pin (a crystal across its two pins, the load
 * capacitors beside the crystal on the side away from the chip, a pull-up, an LED's resistor beside the LED), connectors on the nearest edge with their pins inward), then simulated annealing on the total ratsnest length.
 * Pure: it reads the design and returns positions; writing them is the caller's. Same input, same output.
 */
export function placeBoard(design: Design, options: PlaceOptions = {}): Placement {
  const copies = planCopies(design, options)
  const problem = readProblem(design, options, copies.aside)
  const start: State = {
    x: Float64Array.from(problem.movables, (m) => m.start.x),
    y: Float64Array.from(problem.movables, (m) => m.start.y),
    rot: Uint8Array.from(problem.movables, (m) => quarterOf(m.start.rotation)),
  }
  const clock = options.clock ?? (() => performance.now())
  const began = clock()
  const { budgetMs } = options
  const late = budgetMs === undefined ? () => false : () => clock() - began >= budgetMs
  const tell = options.onProgress
  const initial: State = { x: start.x.slice(), y: start.y.slice(), rot: start.rot.slice() }
  const onTries = tell && ((done: number, total: number) => tell({ stage: "refine", done, total }))
  const run = (state: State, ahead: boolean, report: boolean) => {
    const built = construct(problem, state, late, report && tell ? (done, total) => tell({ stage: "construct", done, total }) : undefined, ahead)
    const frozen = new Set(built.unplaced.map((u) => u.index))
    const left = budgetMs === undefined ? {} : { budgetMs: Math.max(0, budgetMs - (clock() - began)) }
    const refined = options.refine === false ? undefined : refine(problem, state, frozen, { ...options, ...left, clock, ...(report && onTries ? { onTries } : {}) })
    const final = refined?.state ?? state
    return { built, frozen, refined, final, wire: refined?.after ?? new NetModel(problem).measure(final) }
  }
  // Connectors last, then again with each connector on the edge ahead of the part it serves; the second is kept when
  // it finished in time and places as many parts with less wire in all and on the connectors' own nets. Only the
  // first is told to `onProgress`; the second has what is left of the time budget.
  const last = run(start, false, true)
  const spent = (r: typeof last) => r.built.unplaced.some((u) => u.reason === OUT_OF_TIME) || (r.refined?.budgetSpent ?? false)
  const trial = !spent(last) && !late() && problem.movables.some((m) => m.role === "connector") ? run(initial, true, false) : undefined
  const better =
    trial !== undefined &&
    !spent(trial) &&
    trial.built.ahead > 0 &&
    trial.built.unplaced.length <= last.built.unplaced.length &&
    trial.wire < last.wire - 1e-9 &&
    connectorWire(problem, trial.final) <= connectorWire(problem, last.final) + 1e-9
  const { built, frozen, refined, final } = better ? trial : last
  const positions = new Map<string, PlacedPosition>()
  const moved: string[] = []
  problem.movables.forEach((m, i) => {
    if (frozen.has(i)) return
    const at = { x: tidy(final.x[i] as number), y: tidy(final.y[i] as number), rotation: ROTATIONS[final.rot[i] as number] as number }
    positions.set(m.name, at)
    const same = Math.abs(at.x - m.start.x) < EPSILON && Math.abs(at.y - m.start.y) < EPSILON && at.rotation === m.start.rotation
    if (!same) moved.push(m.name)
  })
  const outOfTime = built.unplaced.some((u) => u.reason === OUT_OF_TIME)
  const copied = placeCopies(design, problem, { final, frozen, positions }, copies.followers)
  return {
    positions,
    blocks: copied.blocks,
    score: { wireLength: refined?.after ?? new NetModel(problem).measure(final), edgeTouches: edgeTouches(problem, final, frozen) },
    before: { wireLength: ratsnestLength(design.pcb.parts) },
    moved,
    unplaced: built.unplaced.map((u) => ({ name: problem.movables[u.index]?.name as string, reason: u.reason })),
    notes: [...built.notes, ...copies.notes, ...copied.notes],
    budgetSpent: outOfTime || (refined?.budgetSpent ?? false),
  }
}
