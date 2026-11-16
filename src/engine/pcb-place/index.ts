import type { Design } from "../design.js"
import { placeByBlocks, placesByBlocks } from "./block-board.js"
import { planCopies, placeCopies, type BlockMove } from "./blocks.js"
import { connectorsServe, construct, LARGE_NET, OUT_OF_TIME, type Constructed } from "./constructive.js"
import { EPSILON, ROTATIONS } from "./geometry.js"
import { refine, type Refined, type RefineOptions } from "./refine.js"
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
  /**
   * Whether to also try putting each connector on the edge ahead of the part it serves, and keep that when it has
   * less wire; false by default (connectors last only). Not the default because it can route worse: on the proof
   * CAN board at 30 x 22 mm it leaves one ground connection unrouted. A caller choosing it should route and compare.
   */
  connectorsAhead?: boolean
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
  /**
   * Instances of a sheet that found no free room on the board as a block and were put beside it instead (never on
   * another instance), with the reason; fitting the board afterwards grows it round them.
   */
  beside: { instance: string; reason: string }[]
  /** Whether the time budget ran out, in the constructive pass or the refinement. */
  budgetSpent: boolean
}

/** The ratsnest length of the small nets that reach a connector, with the parts where `s` puts them. */
function connectorWire(problem: Problem, s: State): number {
  const model = new NetModel(problem)
  const nets = new Set(problem.movables.flatMap((m) => (m.role === "connector" ? (m.pads[0] ?? []).map((p) => p.net) : [])))
  let total = 0
  for (const net of nets) if (net >= 0 && (model.members[net]?.length ?? 0) + (problem.fixedPads[net]?.length ?? 0) <= LARGE_NET) total += model.netLength(net, s)
  return total
}

/** One constructive pass and its refinement. */
interface Run {
  built: Constructed
  frozen: Set<number>
  refined: Refined | undefined
  final: State
  wire: number
}

/** Whether a run stopped for the time budget, in the constructive pass or the refinement. */
const spent = (r: Run): boolean => r.built.unplaced.some((u) => u.reason === OUT_OF_TIME) || (r.refined?.budgetSpent ?? false)

/**
 * The run to keep: the one with connectors ahead of the parts they serve when it finished in time, put a connector
 * ahead at all, places as many parts, and has less wire in all and on the connectors' own nets; else the old order.
 */
function chooseOrder(problem: Problem, last: Run, ahead: Run | undefined): Run {
  if (ahead === undefined || spent(ahead) || ahead.built.ahead === 0) return last
  if (ahead.built.unplaced.length > last.built.unplaced.length || ahead.wire >= last.wire - 1e-9) return last
  return connectorWire(problem, ahead.final) <= connectorWire(problem, last.final) + 1e-9 ? ahead : last
}

/** Positions are given to the micrometre: the steps the placer takes leave float noise below that. */
const tidy = (v: number): number => Math.round(v * 1e6) / 1e6
const quarterOf = (rotation: number): number => Math.round(rotation / 90) & 3

/**
 * Places the parts nobody placed or locked (in the scope) by connectivity: a constructive pass (the chip with most
 * connections first, each next part at the spot that costs least wire, decoupling capacitors beside their supply
 * pins and every other two-pin part a chip's net ties it to beside that pin (a crystal across its two pins, the load
 * capacitors beside the crystal on the side away from the chip, a pull-up, an LED's resistor beside the LED), connectors on the nearest edge with their pins inward), then simulated annealing on the total ratsnest length.
 * With `connectorsAhead`, when a connector serves a part, the whole is run a second time with that connector put on the edge just before
 * its part, and that second placement is kept when it is better (see `chooseOrder`).
 * Pure: it reads the design and returns positions; writing them is the caller's. Same input, same output.
 */
export function placeBoard(design: Design, options: PlaceOptions = {}): Placement {
  if (placesByBlocks(design, options)) {
    const byBlocks = placeByBlocks(design, options, (instance) => placeBoard(design, { ...options, scope: { kind: "instance", instance } }))
    if (byBlocks) return byBlocks
  }
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
  const run = (state: State, ahead: boolean, report: boolean): Run => {
    const built = construct(problem, state, late, report && tell ? (done, total) => tell({ stage: "construct", done, total }) : undefined, ahead)
    const frozen = new Set(built.unplaced.map((u) => u.index))
    const left = budgetMs === undefined ? {} : { budgetMs: Math.max(0, budgetMs - (clock() - began)) }
    const refined = options.refine === false ? undefined : refine(problem, state, frozen, { ...options, ...left, clock, ...(report && onTries ? { onTries } : {}) })
    const final = refined?.state ?? state
    return { built, frozen, refined, final, wire: refined?.after ?? new NetModel(problem).measure(final) }
  }
  const last = run(start, false, true)
  const tryAhead = options.connectorsAhead === true && !spent(last) && !late() && connectorsServe(problem)
  const chosen = chooseOrder(problem, last, tryAhead ? run(initial, true, false) : undefined)
  const { built, frozen, refined, final } = chosen
  // Asked for and not kept: the caller is told, so that it does not compare two placements that are the same.
  const orderNotes =
    options.connectorsAhead === true && chosen === last
      ? ["Connectors ahead was not kept (no connector serves a part, the time ran out, or it gave no less wire); this is the placement with connectors last"]
      : []
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
    notes: [...built.notes, ...copies.notes, ...copied.notes, ...orderNotes],
    beside: copied.beside,
    budgetSpent: outOfTime || (refined?.budgetSpent ?? false),
  }
}
