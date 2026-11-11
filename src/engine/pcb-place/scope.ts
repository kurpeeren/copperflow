import { MIN_OUTLINE_POINTS } from "../board.js"
import type { Design } from "../design.js"
import { anchorGroups } from "../instance-anchor.js"
import type { Component, Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PlacedFootprint } from "../pcb.js"
import { boxOfPoints, isRectangle, turn, type Area, type Box } from "./geometry.js"
import { roles, type Beside, type Role } from "./roles.js"

/** Which parts the placer may move: all, the named ones, or those of one sub-sheet instance ("PS1" takes PS1/R1 too). */
export type PlaceScope = { kind: "all" } | { kind: "parts"; parts: readonly string[] } | { kind: "instance"; instance: string }

/** The courtyard gap when the rules give none, in mm. */
export const DEFAULT_COURTYARD_CLEARANCE = 0.25
/** Without a board, parts may go this far from the origin (mm). */
const NO_BOARD_REACH = 100

/** A pad relative to its part's origin at one rotation, and the index of its net in `Problem.nets`. */
export interface LocalPad {
  x: number
  y: number
  net: number
}

/** A part the placer moves. `boxes[r]` and `pads[r]` are its courtyard bounds and pads at ROTATIONS[r]. */
export interface Movable {
  name: string
  component: Component
  boxes: Box[]
  pads: LocalPad[][]
  role: Role
  /** For a part that sits beside another's pins (a decoupling capacitor, a crystal, a pull-up): that part and the pads. */
  beside?: Beside
  /** Its sub-sheet instance's place on the board, when the instance has one: where it starts when nothing pulls it. */
  anchor?: Point
  /** Pins on nets with another pad. */
  connections: number
  /** Where the build put it. */
  start: { x: number; y: number; rotation: number }
}

/** A courtyard, keepout or hole that stays where it is; `part` is set for a part's courtyard. */
export interface Obstacle {
  name: string
  box: Box
  part: boolean
}

/** Everything placement needs, read once from the design. */
export interface Problem {
  movables: Movable[]
  /** Courtyard bounds of what stays: parts not moved, keepouts and holes. */
  obstacles: Obstacle[]
  /** Net ids by index. */
  nets: string[]
  /** The pads of parts not moved, per net index. */
  fixedPads: Point[][]
  /** Fixed parts' pads by part name, in footprint pad order (for decoupling). */
  fixedPartPads: Map<string, (Point & { net?: number })[]>
  /** What the fixed parts sit beside (a hand-placed crystal's chip pins), so their own satellites keep to the far side. */
  fixedBeside: Map<string, Beside>
  area: Area
  /** The gap kept between courtyards (and to keepouts and holes), in mm. */
  clearance: number
}

export interface ScopeOptions {
  scope?: PlaceScope
  /** Parts a person locked: they never move. */
  locked?: readonly string[]
}

/** The parts the placer may move: the auto-placed parts of the scope that nobody locked. */
export function movingParts(design: Design, options: ScopeOptions = {}): Set<string> {
  const scope = options.scope ?? { kind: "all" }
  const locked = new Set(options.locked ?? [])
  const components = new Map(design.circuit.components.map((c) => [c.id, c]))
  return new Set(
    design.pcb.parts
      .filter((part) => {
        const component = components.get(part.component)
        return part.autoPlaced && !locked.has(part.component) && component !== undefined && inScope(component, scope)
      })
      .map((part) => part.component),
  )
}

function inScope(component: Component, scope: PlaceScope): boolean {
  if (scope.kind === "all") return true
  if (scope.kind === "parts") return scope.parts.includes(component.id)
  const path = component.instance
  return path !== undefined && (path === scope.instance || path.startsWith(`${scope.instance}/`))
}

function areaOf(design: Design): Area {
  const edge = design.rules.fabrication.boardEdgeClearance
  const outline = design.pcb.board?.outline ?? []
  if (outline.length < MIN_OUTLINE_POINTS) {
    return { box: { minX: -NO_BOARD_REACH, minY: -NO_BOARD_REACH, maxX: NO_BOARD_REACH, maxY: NO_BOARD_REACH }, edge }
  }
  const b = boxOfPoints(outline)
  const box = { minX: b.minX + edge, minY: b.minY + edge, maxX: b.maxX - edge, maxY: b.maxY - edge }
  return isRectangle(outline) ? { box, edge } : { box, polygon: outline, edge }
}

/** Keepouts and holes as boxes: what no courtyard may come near. */
function boardObstacles(design: Design): Obstacle[] {
  const keepouts = (design.pcb.board?.keepouts ?? []).map((k) => ({ name: k.id, box: boxOfPoints(k.outline), part: false }))
  const holes = design.pcb.holes.map((h) => {
    const r = h.diameter / 2
    return { name: h.id, box: { minX: h.x - r, minY: h.y - r, maxX: h.x + r, maxY: h.y + r }, part: false }
  })
  return [...keepouts, ...holes]
}

interface PartFacts {
  component: Component
  role: Role
  beside: Beside | undefined
  anchor: Point | undefined
}

function movable(part: PlacedFootprint, facts: PartFacts, netIndex: ReadonlyMap<string, number>, connected: ReadonlySet<string>): Movable {
  const courtyard = part.footprint?.courtyard ?? part.courtyard.map((p) => ({ x: p.x - part.x, y: p.y - part.y }))
  const local = (part.footprint?.pads ?? []).map((pad, i) => ({ x: pad.x, y: pad.y, net: part.pads[i]?.net }))
  const boxes = [0, 1, 2, 3].map((q) => boxOfPoints(courtyard.map((p) => turn(p, q))))
  const pads = [0, 1, 2, 3].map((q) =>
    local.map((pad) => {
      const t = turn(pad, q)
      return { x: t.x, y: t.y, net: pad.net === undefined ? -1 : (netIndex.get(pad.net) as number) }
    }),
  )
  const connections = part.pads.filter((pad) => pad.net !== undefined && connected.has(pad.net)).length
  const start = { x: part.x, y: part.y, rotation: part.rotation }
  const { component, role, beside, anchor } = facts
  return { name: part.component, component, boxes, pads, role, connections, start, ...(beside ? { beside } : {}), ...(anchor ? { anchor } : {}) }
}

/**
 * Reads the design into a placement problem. The parts to place are the auto-placed parts of the scope that nobody
 * locked; every other part, the keepouts and the holes are obstacles. The parts in `aside` are neither: they belong to
 * instances placed as whole blocks once the rest is placed.
 */
export function readProblem(design: Design, options: ScopeOptions = {}, aside: ReadonlySet<string> = new Set()): Problem {
  const components = new Map(design.circuit.components.map((c) => [c.id, c]))
  const nets = [...new Set(design.pcb.parts.flatMap((p) => p.pads.flatMap((pad) => (pad.net === undefined ? [] : [pad.net]))))].sort(naturalCompare)
  const netIndex = new Map(nets.map((n, i) => [n, i]))
  const padCounts = new Map<string, number>()
  for (const part of design.pcb.parts) for (const pad of part.pads) if (pad.net !== undefined) padCounts.set(pad.net, (padCounts.get(pad.net) ?? 0) + 1)
  const connected = new Set([...padCounts].filter(([, n]) => n > 1).map(([net]) => net))
  const moving = movingParts(design, options)
  const moves = (part: PlacedFootprint) => moving.has(part.component)
  const roleOf = roles(design)
  const placing = design.pcb.parts.filter((p) => moves(p) && !aside.has(p.component)).map((p) => components.get(p.component) as Component)
  const anchors = new Map(anchorGroups(design.circuit, placing, "pcb").flatMap((g) => (g.anchor ? g.parts.map((c) => [c.id, g.anchor as Point] as const) : [])))
  const movables: Movable[] = []
  const obstacles = boardObstacles(design)
  const fixedPads: Point[][] = nets.map(() => [])
  const fixedPartPads = new Map<string, (Point & { net?: number })[]>()
  const fixedBeside = new Map<string, Beside>()
  for (const part of [...design.pcb.parts].sort((a, b) => naturalCompare(a.component, b.component))) {
    if (aside.has(part.component)) continue
    if (moves(part)) {
      const name = part.component
      const facts = { component: components.get(name) as Component, role: roleOf.role(name), beside: roleOf.beside(name), anchor: anchors.get(name) }
      movables.push(movable(part, facts, netIndex, connected))
      continue
    }
    obstacles.push({ name: part.component, box: boxOfPoints(part.courtyard), part: true })
    for (const pad of part.pads) if (pad.net !== undefined) fixedPads[netIndex.get(pad.net) as number]?.push({ x: pad.x, y: pad.y })
    fixedPartPads.set(part.component, part.pads.map((pad) => ({ x: pad.x, y: pad.y, ...(pad.net !== undefined ? { net: netIndex.get(pad.net) as number } : {}) })))
    const beside = roleOf.beside(part.component)
    if (beside) fixedBeside.set(part.component, beside)
  }
  return { movables, obstacles, nets, fixedPads, fixedPartPads, fixedBeside, area: areaOf(design), clearance: DEFAULT_COURTYARD_CLEARANCE }
}
