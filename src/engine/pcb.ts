import { boundsOf, findSpot, type Bounds } from "./autoplace.js"
import { diagnostic } from "./diagnostics.js"
import type { Footprint, Pad } from "./footprints/types.js"
import type { Board, Circuit, Component, Diagnostic, Point } from "./model.js"
import { naturalCompare } from "./order.js"
import { ratsnest } from "./ratsnest.js"

export interface WorldPad extends Pad {
  /** "<component>#<pad number>"; a repeated number adds "#2", "#3" and so on. */
  id: string
  component: string
  pin?: string
  net?: string
}

export interface PlacedFootprint {
  component: string
  x: number
  y: number
  rotation: number
  side: "top" | "bottom"
  autoPlaced: boolean
  footprint?: Footprint
  pads: WorldPad[]
  courtyard: Point[]
  silkscreen: Point[][]
  fabrication: Point[][]
}

export interface RatsnestLine {
  net: string
  from: string
  to: string
  a: Point
  b: Point
}

export interface PcbLayout {
  board?: Board
  parts: PlacedFootprint[]
  ratsnest: RatsnestLine[]
}

type FootprintOf = (component: Component) => Footprint | { error: string }
interface Placement {
  x: number
  y: number
  rotation: number
  side: "top" | "bottom"
}
interface Resolved {
  component: Component
  footprint: Footprint | undefined
}

/** A part without a usable footprint occupies this square (mm), centred on the part. */
const FALLBACK_SIZE = 1
const HALF = FALLBACK_SIZE / 2
const FALLBACK_COURTYARD: readonly Point[] = [
  { x: -HALF, y: -HALF },
  { x: HALF, y: -HALF },
  { x: HALF, y: HALF },
  { x: -HALF, y: HALF },
]
const FULL_TURN = 360
const AUTO_PLACEMENT = { rotation: 0, side: "top" } as const

const normalise = (degrees: number) => ((degrees % FULL_TURN) + FULL_TURN) % FULL_TURN

/** Rotate counter-clockwise, mirror x on the bottom side, then move. */
function transformPoint(p: Point, at: Placement): Point {
  const radians = (at.rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
  const [rx, ry] = [p.x * cos - p.y * sin, p.x * sin + p.y * cos]
  return { x: at.x + (at.side === "bottom" ? -rx : rx), y: at.y + ry }
}

function worldPad(pad: Pad, at: Placement, component: Component, id: string, nets: ReadonlyMap<string, string>): WorldPad {
  const { x, y } = transformPoint(pad, at)
  const turned = normalise(pad.rotation + at.rotation)
  const pinId = `${component.id}.pin${pad.number}`
  const pin = component.pins.some((p) => p.id === pinId) ? pinId : undefined
  const net = pin === undefined ? undefined : nets.get(pin)
  const bottom = at.side === "bottom"
  return {
    ...pad,
    id,
    component: component.id,
    x,
    y,
    rotation: bottom ? normalise(FULL_TURN - turned) : turned,
    layers: bottom && pad.layers === "top" ? "bottom" : pad.layers,
    ...(pin !== undefined ? { pin } : {}),
    ...(net !== undefined ? { net } : {}),
  }
}

function worldPads(footprint: Footprint, at: Placement, component: Component, nets: ReadonlyMap<string, string>): WorldPad[] {
  const seen = new Map<string, number>()
  return footprint.pads.map((pad) => {
    const count = (seen.get(pad.number) ?? 0) + 1
    seen.set(pad.number, count)
    const id = `${component.id}#${pad.number}${count > 1 ? `#${count}` : ""}`
    return worldPad(pad, at, component, id, nets)
  })
}

function place(component: Component, footprint: Footprint | undefined, at: Placement, autoPlaced: boolean, nets: ReadonlyMap<string, string>): PlacedFootprint {
  const move = (points: readonly Point[]) => points.map((p) => transformPoint(p, at))
  return {
    component: component.id,
    x: at.x,
    y: at.y,
    rotation: at.rotation,
    side: at.side,
    autoPlaced,
    ...(footprint ? { footprint } : {}),
    pads: footprint ? worldPads(footprint, at, component, nets) : [],
    courtyard: move(footprint?.courtyard ?? FALLBACK_COURTYARD),
    silkscreen: (footprint?.silkscreen ?? []).map(move),
    fabrication: (footprint?.fabrication ?? []).map(move),
  }
}

function resolveFootprints(circuit: Circuit, footprintOf: FootprintOf): { resolved: Resolved[]; diagnostics: Diagnostic[]; missing: string[] } {
  const diagnostics: Diagnostic[] = []
  const missing: string[] = []
  const resolved = circuit.components.map((component): Resolved => {
    if (component.footprint === undefined) {
      missing.push(component.id)
      return { component, footprint: undefined }
    }
    const result = footprintOf(component)
    if ("error" in result) {
      diagnostics.push(diagnostic("footprint", "error", `${component.id}: ${result.error}`, [component.id], component.source))
      return { component, footprint: undefined }
    }
    return { component, footprint: result }
  })
  return { resolved, diagnostics, missing }
}

function pinNets(circuit: Circuit): Map<string, string> {
  return new Map(circuit.nets.flatMap((net) => net.pins.map((pin) => [pin, net.id] as const)))
}

/** Places every part; parts without a position go to the first free spot, in id order. */
function placeAll(circuit: Circuit, resolved: readonly Resolved[], nets: ReadonlyMap<string, string>): { parts: PlacedFootprint[] } {
  const byId = new Map<string, PlacedFootprint>()
  const occupied: Bounds[] = []
  for (const { component, footprint } of resolved) {
    if (!component.pcb) continue
    const part = place(component, footprint, component.pcb, false, nets)
    byId.set(component.id, part)
    occupied.push(boundsOf(part.courtyard))
  }
  const board = circuit.board ? boundsOf(circuit.board.outline) : undefined
  const unplaced = resolved.filter(({ component }) => !component.pcb).sort((a, b) => naturalCompare(a.component.id, b.component.id))
  for (const { component, footprint } of unplaced) {
    const relative = boundsOf(footprint?.courtyard ?? FALLBACK_COURTYARD)
    const part = place(component, footprint, { ...AUTO_PLACEMENT, ...findSpot(relative, occupied, board) }, true, nets)
    byId.set(component.id, part)
    occupied.push(boundsOf(part.courtyard))
  }
  return { parts: circuit.components.map((c) => byId.get(c.id) as PlacedFootprint) }
}

export function layoutPcb(circuit: Circuit, footprintOf: FootprintOf): { layout: PcbLayout; diagnostics: Diagnostic[] } {
  const { resolved, diagnostics, missing } = resolveFootprints(circuit, footprintOf)
  const { parts } = placeAll(circuit, resolved, pinNets(circuit))
  if (missing.length > 0) {
    diagnostics.push(diagnostic("no-footprint", "warning", "These parts have no footprint and are drawn as 1 x 1 mm squares without pads", missing))
  }
  return { layout: { ...(circuit.board ? { board: circuit.board } : {}), parts, ratsnest: ratsnest(parts) }, diagnostics }
}
