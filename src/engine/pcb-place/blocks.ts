// Instances of one sheet as rigid copies. A sheet file holds one position per part for all its instances, so once the
// first instance is placed every other instance of that sheet has the same arrangement, offset by its own anchor. The
// placer places the first one part by part, then each other one as a whole block: the instance's anchor (pcbX/pcbY,
// its rotation kept) moves so its courtyards overlap nothing, inside the board, near the pads it connects to.
import type { Design } from "../design.js"
import { frameTurn } from "../instance-anchor.js"
import type { Component, Point, SheetInstance } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PlacedFootprint } from "../pcb.js"
import { boxOfPoints, GRID, inArea, moved, tooClose, turn, type Box } from "./geometry.js"
import { movingParts, type Problem, type ScopeOptions } from "./scope.js"
import type { State } from "./score.js"

/** An instance moved as a whole: its anchor shifts by (dx, dy) on the board; `parts` are those that move with it. */
export interface BlockMove {
  instance: string
  dx: number
  dy: number
  parts: string[]
}

/** An instance to place as a block, and the instance of the same sheet whose arrangement it copies. */
export interface Follower {
  instance: SheetInstance
  leader: SheetInstance
}

export interface Copies {
  followers: Follower[]
  /** The followers' parts: the part-by-part placement leaves them out. */
  aside: Set<string>
  notes: string[]
}

interface Pose {
  x: number
  y: number
  rotation: number
}

interface Body {
  parts: string[]
  boxes: Box[]
  pads: { x: number; y: number; net: string }[]
}

/** The candidate anchors tried along each side of the board, at most. */
const STEPS = 100

const tidy = (v: number): number => Math.round(v * 1e6) / 1e6 || 0
const normal = (degrees: number): number => tidy(((degrees % 360) + 360) % 360)

function rotate(p: Point, degrees: number): Point {
  const quarter = degrees / 90
  if (Number.isInteger(quarter)) return turn(p, quarter)
  const r = (degrees * Math.PI) / 180
  return { x: p.x * Math.cos(r) - p.y * Math.sin(r), y: p.x * Math.sin(r) + p.y * Math.cos(r) }
}

const isLocked = (instance: SheetInstance, locked: ReadonlySet<string>) => locked.has(instance.path) || instance.parts.some((part) => locked.has(part))

/**
 * The instances to place as blocks. For the whole board: in each group of top-level instances of one sheet, every
 * instance but the first with a part to place (or the first). For one instance with nothing of its own to place: that
 * instance. A locked instance, or one with a locked part, is left where it is and named.
 */
export function planCopies(design: Design, options: ScopeOptions): Copies {
  const scope = options.scope ?? { kind: "all" }
  const copies: Copies = { followers: [], aside: new Set(), notes: [] }
  if (scope.kind === "parts") return copies
  const locked = new Set(options.locked ?? [])
  const moving = movingParts(design, options)
  const top = (design.circuit.instances ?? []).filter((instance) => !instance.path.includes("/")).sort((a, b) => naturalCompare(a.path, b.path))
  const files = [...new Set(top.map((instance) => instance.file))]
  for (const file of files) {
    const group = top.filter((instance) => instance.file === file)
    if (group.length < 2) continue
    const own = (instance: SheetInstance) => instance.parts.some((part) => moving.has(part))
    let pairs: Follower[]
    if (scope.kind === "all") {
      const leader = group.find(own) ?? (group[0] as SheetInstance)
      pairs = group.filter((instance) => instance !== leader).map((instance) => ({ instance, leader }))
    } else {
      const asked = group.find((instance) => instance.path === scope.instance)
      const leader = group.find((instance) => instance !== asked)
      pairs = asked && leader && !own(asked) ? [{ instance: asked, leader }] : []
    }
    // A locked copy keeps the sheet's shared positions from being written, so the leader's new arrangement never lands.
    const held = group.find((instance) => isLocked(instance, locked))
    const unwritten = held !== undefined && scope.kind === "all" && pairs.some((pair) => own(pair.leader))
    for (const pair of pairs) {
      if (isLocked(pair.instance, locked)) {
        copies.notes.push(`${pair.instance.path} is locked; it was left where it is`)
        continue
      }
      if (unwritten) {
        copies.notes.push(`${pair.instance.path} was not moved as a block: ${held.path} is locked, so ${file} keeps its positions`)
        continue
      }
      copies.followers.push(pair)
      for (const part of pair.instance.parts) copies.aside.add(part)
    }
  }
  return copies
}

/** Where a part of a follower goes when its twin in the leader goes to `at`: the same place in its own frame. */
function carried(twin: Component, at: Pose, part: Component, instances: readonly SheetInstance[]): Pose {
  const from = frameTurn(instances, twin.instance ?? "")
  const to = frameTurn(instances, part.instance ?? "")
  const local = rotate({ x: at.x - twin.groupOffset.pcb.x, y: at.y - twin.groupOffset.pcb.y }, -from)
  const p = rotate(local, to)
  return { x: tidy(p.x + part.groupOffset.pcb.x), y: tidy(p.y + part.groupOffset.pcb.y), rotation: normal(at.rotation - from + to) }
}

/** A part's courtyard box and pads at `pose`. */
function shapeAt(part: PlacedFootprint, pose: Pose): { box: Box; pads: Body["pads"] } {
  const quarter = Math.round(pose.rotation / 90) & 3
  const courtyard = part.footprint?.courtyard ?? part.courtyard.map((p) => rotate({ x: p.x - part.x, y: p.y - part.y }, -part.rotation))
  const box = moved(boxOfPoints(courtyard.map((p) => turn(p, quarter))), pose.x, pose.y)
  const pads = (part.footprint?.pads ?? []).flatMap((pad, i) => {
    const net = part.pads[i]?.net
    if (net === undefined) return []
    const t = turn(pad, quarter)
    return [{ x: t.x + pose.x, y: t.y + pose.y, net }]
  })
  return { box, pads }
}

/** The follower's parts where they will be once the leader's arrangement is written; parts the build packs are left out. */
function bodyOf(design: Design, follower: Follower, positions: ReadonlyMap<string, Pose>): Body {
  const components = new Map(design.circuit.components.map((c) => [c.id, c]))
  const parts = new Map(design.pcb.parts.map((p) => [p.component, p]))
  const instances = design.circuit.instances ?? []
  const { instance, leader } = follower
  const twinOf = (component: Component) => {
    const path = `${leader.path}${(component.instance ?? "").slice(instance.path.length)}`
    return design.circuit.components.find((c) => c.instance === path && c.localId === component.localId)
  }
  const body: Body = { parts: [], boxes: [], pads: [] }
  for (const name of [...instance.parts].sort(naturalCompare)) {
    const component = components.get(name)
    const part = parts.get(name)
    if (!component || !part) continue
    const twin = twinOf(component)
    const at = twin ? positions.get(twin.id) : undefined
    if (!at && part.autoPlaced) continue
    const shape = shapeAt(part, at ? carried(twin as Component, at, component, instances) : { x: part.x, y: part.y, rotation: part.rotation })
    body.parts.push(name)
    body.boxes.push(shape.box)
    body.pads.push(...shape.pads)
  }
  return body
}

/** The courtyards and pads already on the board once the part-by-part placement is done. */
function surroundings(problem: Problem, final: State, frozen: ReadonlySet<number>): { taken: Box[]; targets: Map<string, Point[]> } {
  const taken = problem.obstacles.map((o) => o.box)
  const targets = new Map<string, Point[]>()
  const add = (net: string, p: Point) => targets.set(net, [...(targets.get(net) ?? []), p])
  problem.fixedPads.forEach((pads, k) => pads.forEach((p) => add(problem.nets[k] as string, p)))
  problem.movables.forEach((m, i) => {
    if (frozen.has(i)) return
    const [x, y, r] = [final.x[i] as number, final.y[i] as number, final.rot[i] as number]
    taken.push(moved(m.boxes[r] as Box, x, y))
    for (const pad of m.pads[r] ?? []) if (pad.net >= 0) add(problem.nets[pad.net] as string, { x: pad.x + x, y: pad.y + y })
  })
  return { taken, targets }
}

/** The shift that puts the body in free room nearest the pads it connects to, or undefined when there is none. */
function freeShift(body: Body, problem: Problem, taken: readonly Box[], targets: ReadonlyMap<string, Point[]>): Point | undefined {
  const fits = (dx: number, dy: number) =>
    body.boxes.every((b) => {
      const at = moved(b, dx, dy)
      return inArea(at, problem.area) && !taken.some((t) => tooClose(at, t, problem.clearance))
    })
  const bounds = boxOfPoints(body.boxes.flatMap((b) => [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]))
  const area = problem.area.box
  const range = { lo: { x: area.minX - bounds.minX, y: area.minY - bounds.minY }, hi: { x: area.maxX - bounds.maxX, y: area.maxY - bounds.maxY } }
  if (range.lo.x > range.hi.x || range.lo.y > range.hi.y) return undefined
  const step = Math.ceil(Math.max(range.hi.x - range.lo.x, range.hi.y - range.lo.y) / STEPS / GRID) * GRID || GRID
  const linked = body.pads.filter((pad) => (targets.get(pad.net)?.length ?? 0) > 0)
  const cost = (dx: number, dy: number) =>
    linked.length === 0
      ? Math.hypot(dx, dy)
      : linked.reduce((sum, pad) => sum + Math.min(...(targets.get(pad.net) as Point[]).map((t) => Math.hypot(pad.x + dx - t.x, pad.y + dy - t.y))), 0)
  const candidates: { dx: number; dy: number; cost: number }[] = []
  for (let dx = Math.ceil(range.lo.x / GRID) * GRID; dx <= range.hi.x + 1e-9; dx += step) {
    for (let dy = Math.ceil(range.lo.y / GRID) * GRID; dy <= range.hi.y + 1e-9; dy += step) candidates.push({ dx: tidy(dx), dy: tidy(dy), cost: cost(dx, dy) })
  }
  candidates.sort((a, b) => a.cost - b.cost || Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy) || a.dx - b.dx || a.dy - b.dy)
  const found = candidates.find((c) => fits(c.dx, c.dy))
  return found ? { x: found.dx, y: found.dy } : undefined
}

/**
 * Places each follower as a block once the rest is placed (`positions` and `final`): an instance without an anchor of
 * its own, or whose copy would overlap something or leave the board, moves to the free spot nearest its connections.
 */
export function placeCopies(
  design: Design,
  problem: Problem,
  placed: { final: State; frozen: ReadonlySet<number>; positions: ReadonlyMap<string, Pose> },
  followers: readonly Follower[],
): { blocks: BlockMove[]; notes: string[] } {
  const { taken, targets } = surroundings(problem, placed.final, placed.frozen)
  const blocks: BlockMove[] = []
  const notes: string[] = []
  for (const follower of followers) {
    const body = bodyOf(design, follower, placed.positions)
    if (body.parts.length === 0) continue
    const free = (dx: number, dy: number) => body.boxes.every((b) => inArea(moved(b, dx, dy), problem.area) && !taken.some((t) => tooClose(moved(b, dx, dy), t, problem.clearance)))
    const stays = follower.instance.pcb !== undefined && free(0, 0)
    const shift = stays ? { x: 0, y: 0 } : freeShift(body, problem, taken, targets)
    if (!shift) {
      notes.push(`${follower.instance.path} found no free room as a block; it was left where it is`)
      continue
    }
    for (const b of body.boxes) taken.push(moved(b, shift.x, shift.y))
    for (const pad of body.pads) targets.set(pad.net, [...(targets.get(pad.net) ?? []), { x: pad.x + shift.x, y: pad.y + shift.y }])
    if (stays) continue
    blocks.push({ instance: follower.instance.path, dx: shift.x, dy: shift.y, parts: body.parts })
    notes.push(`${follower.instance.path} was moved as a block, keeping the arrangement of ${follower.leader.path}`)
  }
  return { blocks, notes }
}
