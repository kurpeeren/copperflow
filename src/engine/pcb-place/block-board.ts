// A board with sub-sheet instances placed by its blocks, as a person lays it out: each sheet's first instance is laid
// out on its own (its parts packed tight, nothing else in the way), then every instance becomes one rigid body (its
// courtyards' bounds, its pads) and the bodies, the connectors and the other parts are placed together by the same
// constructive pass and refinement as single parts: the body or chip with most connections first, each next one where
// it costs least wire, side by side with the courtyard clearance between them; connectors on the edge nearest the
// blocks they serve, pins inward. Every instance of one sheet keeps the same arrangement and the same turn: the four
// turns are tried for all of them at once and the one with least wire is kept. A body with no room on the board goes
// beside it (fitting the board then grows it round the body), never on another.
import type { Design } from "../design.js"
import type { Component, Point, SheetInstance } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PlacedFootprint } from "../pcb.js"
import { besideShift } from "./blocks.js"
import { construct, OUT_OF_TIME } from "./constructive.js"
import { boxOfPoints, EPSILON, moved as movedBox, ROTATIONS, turn, type Box } from "./geometry.js"
import type { BlockMove, PlacedPosition, Placement, PlaceOptions } from "./index.js"
import { refine } from "./refine.js"
import { readProblem, type LocalPad, type Movable, type Problem } from "./scope.js"
import { edgeTouches, NetModel, ratsnestLength, type State } from "./score.js"

interface Frame {
  x: number
  y: number
  rotation: number
}

/** One instance as a rigid body, in its own frame at its sheet's arrangement: courtyard bounds and pads (net ids). */
interface Body {
  instance: SheetInstance
  leader: SheetInstance
  frame: Frame
  box: Box
  pads: { x: number; y: number; net: string | undefined }[]
}

const frameOf = (instance: SheetInstance): Frame => instance.pcb ?? { x: 0, y: 0, rotation: 0 }
const tidy = (v: number): number => Math.round(v * 1e6) / 1e6 || 0
const quarterOf = (degrees: number): number => Math.round(degrees / 90) & 3
const isLocked = (instance: SheetInstance, locked: ReadonlySet<string>) => locked.has(instance.path) || instance.parts.some((part) => locked.has(part))

function rotate(p: Point, degrees: number): Point {
  const quarter = degrees / 90
  if (Number.isInteger(quarter)) return turn(p, quarter)
  const r = (degrees * Math.PI) / 180
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) }
}

const toLocal = (p: Point, frame: Frame): Point => rotate({ x: p.x - frame.x, y: p.y - frame.y }, -frame.rotation)

/** The top-level instances by sheet file, in natural order, each group led by its first instance. */
function sheetGroups(design: Design): SheetInstance[][] {
  const top = (design.circuit.instances ?? []).filter((instance) => !instance.path.includes("/")).sort((a, b) => naturalCompare(a.path, b.path))
  const files = [...new Set(top.map((instance) => instance.file))]
  return files.map((file) => top.filter((instance) => instance.file === file))
}

/** A part's courtyard box and its pads (in footprint order) at a pose on the board. */
function shapeAt(part: PlacedFootprint, pose: PlacedPosition): { box: Box; pads: Point[] } {
  const quarter = quarterOf(pose.rotation)
  const courtyard = part.footprint?.courtyard ?? part.courtyard.map((p) => rotate({ x: p.x - part.x, y: p.y - part.y }, -part.rotation))
  const box = movedBox(boxOfPoints(courtyard.map((p) => turn(p, quarter))), pose.x, pose.y)
  const pads = (part.footprint?.pads ?? []).map((pad) => {
    const t = turn(pad, quarter)
    return { x: t.x + pose.x, y: t.y + pose.y }
  })
  return { box, pads }
}

/**
 * The bodies of one sheet's instances: the leader's parts at `poses` (on the board, in the leader's present frame), taken
 * into the leader's own frame; each other instance has the same shape with its own twins' nets.
 */
function bodiesOf(design: Design, group: readonly SheetInstance[], poses: ReadonlyMap<string, PlacedPosition>): Body[] | undefined {
  const leader = group[0] as SheetInstance
  const components = new Map(design.circuit.components.map((c) => [c.id, c]))
  const parts = new Map(design.pcb.parts.map((p) => [p.component, p]))
  const keyIn = (c: Component, instance: SheetInstance) => `${(c.instance ?? "").slice(instance.path.length)}|${c.localId ?? c.id}`
  const from = frameOf(leader)
  const boxes: Box[] = []
  const local: { key: string; pads: Point[] }[] = []
  for (const id of [...leader.parts].sort(naturalCompare)) {
    const component = components.get(id)
    const part = parts.get(id)
    const pose = poses.get(id)
    if (!component || !part || !pose) return undefined
    const shape = shapeAt(part, pose)
    const corners = [toLocal({ x: shape.box.minX, y: shape.box.minY }, from), toLocal({ x: shape.box.maxX, y: shape.box.maxY }, from)]
    boxes.push(boxOfPoints(corners))
    local.push({ key: keyIn(component, leader), pads: shape.pads.map((p) => toLocal(p, from)) })
  }
  const box = boxOfPoints(boxes.flatMap((b) => [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]))
  return group.map((instance) => {
    const twins = new Map(instance.parts.flatMap((id) => {
      const c = components.get(id)
      return c ? [[keyIn(c, instance), parts.get(id)] as const] : []
    }))
    const pads = local.flatMap(({ key, pads: at }) => at.map((p, k) => ({ x: p.x, y: p.y, net: twins.get(key)?.pads[k]?.net })))
    return { instance, leader, frame: frameOf(instance), box, pads }
  })
}

/** A body as a movable "part" whose origin is its instance's frame origin, turned by `quarter` at every rotation. */
function bodyMovable(body: Body, quarter: number, netIndex: ReadonlyMap<string, number>, connected: ReadonlySet<string>, component: Component): Movable {
  const corners = [turn({ x: body.box.minX, y: body.box.minY }, quarter), turn({ x: body.box.maxX, y: body.box.maxY }, quarter)]
  const box = boxOfPoints(corners)
  const pads: LocalPad[] = body.pads.map((pad) => {
    const t = turn(pad, quarter)
    return { x: t.x, y: t.y, net: pad.net === undefined ? -1 : (netIndex.get(pad.net) ?? -1) }
  })
  const connections = body.pads.filter((pad) => pad.net !== undefined && connected.has(pad.net)).length
  return { name: body.instance.path, component, boxes: [box, box, box, box], pads: [pads, pads, pads, pads], role: "other", connections, start: { x: body.frame.x, y: body.frame.y, rotation: 0 } }
}

interface Solved {
  quarter: number
  problem: Problem
  final: State
  frozen: Set<number>
  unplaced: { index: number; reason: string }[]
  notes: string[]
  wire: number
  budgetSpent: boolean
}

/** For each connector, where the pads it connects to are on average in `sketch` (its own and unplaced ones left out). */
function connectorTargets(problem: Problem, sketch: State, unplaced: ReadonlySet<number>): Map<number, Point> {
  const targets = new Map<number, Point>()
  problem.movables.forEach((m, c) => {
    if (m.role !== "connector") return
    const nets = new Set((m.pads[0] ?? []).map((p) => p.net).filter((n) => n >= 0))
    let [sx, sy, n] = [0, 0, 0]
    problem.movables.forEach((other, k) => {
      if (k === c || unplaced.has(k) || other.role === "connector") return
      for (const pad of other.pads[sketch.rot[k] as number] ?? []) {
        if (!nets.has(pad.net)) continue
        sx += (sketch.x[k] as number) + pad.x
        sy += (sketch.y[k] as number) + pad.y
        n++
      }
    })
    if (n > 0) targets.set(c, { x: sx / n, y: sy / n })
  })
  return targets
}

/** Whether whole-board placement goes by blocks: the scope is the board and it has top-level instances, none locked. */
export function placesByBlocks(design: Design, options: PlaceOptions): boolean {
  if ((options.scope ?? { kind: "all" }).kind !== "all" || options.connectorsAhead === true) return false
  const locked = new Set(options.locked ?? [])
  const groups = sheetGroups(design)
  return groups.length > 0 && groups.every((group) => group.every((instance) => !isLocked(instance, locked)))
}

/**
 * Places the board by its blocks (see the module comment); undefined when a sheet's first instance cannot be laid out
 * on its own, so the caller places the board part by part instead.
 */
export function placeByBlocks(design: Design, options: PlaceOptions, layOut: (instance: string) => Placement): Placement | undefined {
  const clock = options.clock ?? (() => performance.now())
  const began = clock()
  const groups = sheetGroups(design)
  const parts = new Map(design.pcb.parts.map((p) => [p.component, p]))
  const leaderPoses = new Map<string, PlacedPosition>()
  const laidOut = new Map<string, PlacedPosition>()
  const bodies: Body[][] = []
  for (const group of groups) {
    const leader = group[0] as SheetInstance
    const own = leader.parts.some((id) => parts.get(id)?.autoPlaced)
    if (own) {
      const lead = layOut(leader.path)
      if (lead.unplaced.length > 0) return undefined
      for (const [name, pose] of lead.positions) laidOut.set(name, pose)
    }
    for (const id of leader.parts) {
      const part = parts.get(id)
      if (part) leaderPoses.set(id, laidOut.get(id) ?? { x: part.x, y: part.y, rotation: part.rotation })
    }
    const made = bodiesOf(design, group, leaderPoses)
    if (!made) return undefined
    bodies.push(made)
  }
  const aside = new Set(groups.flat().flatMap((instance) => instance.parts))
  const base = readProblem(design, { ...options, scope: { kind: "all" } }, aside)
  const netIndex = new Map(base.nets.map((n, i) => [n, i]))
  const padCounts = new Map<string, number>()
  for (const part of design.pcb.parts) for (const pad of part.pads) if (pad.net !== undefined) padCounts.set(pad.net, (padCounts.get(pad.net) ?? 0) + 1)
  const connected = new Set([...padCounts].filter(([, n]) => n > 1).map(([net]) => net))
  const componentOf = new Map(design.circuit.components.map((c) => [c.id, c]))
  const flat = bodies.flat()
  const left = options.budgetMs === undefined ? undefined : () => Math.max(0, (options.budgetMs as number) - (clock() - began))
  let best: Solved | undefined
  for (let quarter = 0; quarter < 4; quarter++) {
    const macros = flat.map((body) => bodyMovable(body, quarter, netIndex, connected, componentOf.get(body.instance.parts[0] as string) as Component))
    const problem: Problem = { ...base, movables: [...base.movables, ...macros] }
    const fresh = (): State => ({
      x: Float64Array.from(problem.movables, (m) => m.start.x),
      y: Float64Array.from(problem.movables, (m) => m.start.y),
      rot: Uint8Array.from(problem.movables, (m, i) => (i < base.movables.length ? quarterOf(m.start.rotation) : 0)),
    })
    // Each turn gets an equal share of what is left of the budget.
    const share = left === undefined ? undefined : left() / (4 - quarter)
    const runStart = clock()
    const late = share === undefined ? () => false : () => clock() - runStart >= share
    // A first pass, connectors last, shows where the blocks go; then the connectors go first, on the edge nearest the
    // blocks they serve, and the blocks after them.
    const sketch = fresh()
    const first = construct(problem, sketch, late)
    const state = fresh()
    const built = construct(problem, state, late, undefined, false, connectorTargets(problem, sketch, new Set(first.unplaced.map((u) => u.index))))
    const frozen = new Set(built.unplaced.map((u) => u.index))
    const rest = share === undefined ? {} : { budgetMs: Math.max(0, share - (clock() - runStart)) }
    const refined = options.refine === false ? undefined : refine(problem, state, frozen, { ...(options.seed === undefined ? {} : { seed: options.seed }), ...rest, clock })
    const final = refined?.state ?? state
    const wire = refined?.after ?? new NetModel(problem).measure(final)
    const solved: Solved = { quarter, problem, final, frozen, unplaced: built.unplaced, notes: built.notes, wire, budgetSpent: built.unplaced.some((u) => u.reason === OUT_OF_TIME) || (refined?.budgetSpent ?? false) }
    const better = !best || solved.unplaced.length < best.unplaced.length || (solved.unplaced.length === best.unplaced.length && solved.wire < best.wire - 1e-9)
    if (better) best = solved
  }
  const chosen = best as Solved
  return written(design, chosen, flat, base.movables.length, laidOut)
}

/** The placement the chosen run gives: part positions, the leaders' laid-out parts, and every body as a block move. */
function written(design: Design, solved: Solved, flat: readonly Body[], firstBody: number, laidOut: ReadonlyMap<string, PlacedPosition>): Placement {
  const { problem, final, frozen, quarter } = solved
  const positions = new Map<string, PlacedPosition>(laidOut)
  const moved: string[] = [...laidOut.keys()]
  problem.movables.slice(0, firstBody).forEach((m, i) => {
    if (frozen.has(i)) return
    const at = { x: tidy(final.x[i] as number), y: tidy(final.y[i] as number), rotation: ROTATIONS[final.rot[i] as number] as number }
    positions.set(m.name, at)
    if (Math.abs(at.x - m.start.x) >= EPSILON || Math.abs(at.y - m.start.y) >= EPSILON || at.rotation !== m.start.rotation) moved.push(m.name)
  })
  // Bodies with no room on the board go beside it, in order, each clear of what is placed.
  const taken: Box[] = problem.obstacles.map((o) => o.box)
  const targets = new Map<string, Point[]>()
  const add = (net: string, p: Point) => targets.set(net, [...(targets.get(net) ?? []), p])
  problem.fixedPads.forEach((pads, k) => pads.forEach((p) => add(problem.nets[k] as string, p)))
  problem.movables.forEach((m, i) => {
    if (frozen.has(i)) return
    const [x, y, r] = [final.x[i] as number, final.y[i] as number, final.rot[i] as number]
    taken.push(movedBox(m.boxes[r] as Box, x, y))
    for (const pad of m.pads[r] ?? []) if (pad.net >= 0) add(problem.nets[pad.net] as string, { x: pad.x + x, y: pad.y + y })
  })
  const blocks: BlockMove[] = []
  const notes: string[] = [...solved.notes]
  const beside: Placement["beside"] = []
  const rotation = ROTATIONS[quarter] as number
  flat.forEach((body, k) => {
    const i = firstBody + k
    const m = problem.movables[i] as Movable
    let at: Point | undefined = frozen.has(i) ? undefined : { x: final.x[i] as number, y: final.y[i] as number }
    if (!at) {
      const pads = (m.pads[0] ?? []).flatMap((pad) => (pad.net >= 0 ? [{ x: pad.x + m.start.x, y: pad.y + m.start.y, net: problem.nets[pad.net] as string }] : []))
      const shift = besideShift({ parts: [], boxes: [movedBox(m.boxes[0] as Box, m.start.x, m.start.y)], pads }, problem, taken, targets)
      if (!shift) {
        notes.push(`${body.instance.path} found no free room as a block, on the board or beside it; it was left where it is`)
        return
      }
      at = { x: m.start.x + shift.x, y: m.start.y + shift.y }
      taken.push(movedBox(m.boxes[0] as Box, at.x, at.y))
      const b = m.boxes[0] as Box
      beside.push({ instance: body.instance.path, reason: `no free room on the board for its ${(b.maxX - b.minX).toFixed(1)} x ${(b.maxY - b.minY).toFixed(1)} mm block; it was put beside the board` })
    }
    const [dx, dy] = [tidy(at.x - body.frame.x), tidy(at.y - body.frame.y)]
    const turned = Math.abs(rotation - body.frame.rotation) > EPSILON
    if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON && !turned) return
    blocks.push({ instance: body.instance.path, dx, dy, ...(turned ? { rotation } : {}), parts: [...body.instance.parts].sort(naturalCompare) })
    if (body.instance !== body.leader) notes.push(`${body.instance.path} was moved as a block, keeping the arrangement of ${body.leader.path}`)
  })
  return {
    positions,
    blocks,
    score: { wireLength: solved.wire, edgeTouches: edgeTouches(problem, final, frozen) },
    before: { wireLength: ratsnestLength(design.pcb.parts) },
    moved: moved.sort(naturalCompare),
    unplaced: solved.unplaced.filter((u) => u.index < firstBody).map((u) => ({ name: problem.movables[u.index]?.name as string, reason: u.reason })),
    notes,
    beside,
    budgetSpent: solved.budgetSpent,
  }
}

