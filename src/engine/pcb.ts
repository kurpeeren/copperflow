import type { LayoutRecord } from "../core/layout-file.js"
import { boundsOf, findSpot, type Bounds } from "./autoplace.js"
import { usableOutline } from "./board.js"
import type { PcbTrack, PcbVia } from "./copper.js"
import { diagnostic } from "./diagnostics.js"
import { anchorGroups } from "./instance-anchor.js"
import type { Footprint, Pad } from "./footprints/types.js"
import type { Board, BoardGraphic, Circuit, Component, Diagnostic, Hole, Point, SilkText } from "./model.js"
import { naturalCompare } from "./order.js"
import type { PourFill } from "./pour/fill.js"
import { resolveWithPours, type PourFiller } from "./pour/resolve.js"
import { pourMadeConnections, ratsnest } from "./ratsnest.js"

export interface WorldPad extends Pad {
  /** "<component>#<pad number>"; a repeated number adds "#2", "#3" and so on. */
  id: string
  component: string
  pin?: string
  net?: string
  /** Set on the pads of a part with no position: the build packed it only to draw it, so its pads have no place to name. */
  unplaced?: true
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
  /** The middle of the silkscreen designator, when the part's pcbNameAt moves it: its origin plus that offset, in mm. */
  nameAt?: Point
  /**
   * The middle of the silkscreen designator as the fabrication export draws it (fab/designators.ts): `nameAt` when set,
   * else the first free side of the courtyard. buildDesign sets it; the Studio draws the designator there.
   */
  designatorAt?: Point
  /** The designator's turn (0 or 90) when the part's pcbNameRotation sets it. */
  nameRotation?: 0 | 90
  /** Set when the part's pcbNameHidden leaves its designator off the silkscreen. */
  nameHidden?: true
  /** The designator's turn as the fabrication export draws it; buildDesign sets it beside `designatorAt`. */
  designatorRotation?: 0 | 90
  /** "<sheet>/<name in the sheet>" for a part of a sub-sheet instance: the copies of one part share it. */
  copyOf?: string
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
  /** The layout file's tracks and vias, in file order, with the nets their copper resolves to. */
  tracks: PcbTrack[]
  vias: PcbVia[]
  /** The connections copper does not join yet. */
  ratsnest: RatsnestLine[]
  /** The connections the pours make per net, which the ratsnest therefore leaves out; absent or empty without pours. */
  pourMade?: { net: string; count: number }[]
  /** The board's copper pours as filled, in the board's pour order (empty when layoutPcb is given no filler). */
  pours: PourFill[]
  /** The board's non-plated holes, in source order. */
  holes: Hole[]
  /** The board's silkscreen texts, in source order; absent when there are none. */
  silkTexts?: SilkText[]
  /** The drawings from SVG or DXF files, placed; absent when there are none. */
  graphics?: BoardGraphic[]
}

export type { PcbTrack, PcbVia, PourFill }

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
    pads: footprint ? worldPads(footprint, at, component, nets).map((pad) => (autoPlaced ? { ...pad, unplaced: true as const } : pad)) : [],
    courtyard: move(footprint?.courtyard ?? FALLBACK_COURTYARD),
    silkscreen: (footprint?.silkscreen ?? []).map(move),
    fabrication: (footprint?.fabrication ?? []).map(move),
    ...(component.pcbNameAt ? { nameAt: { x: at.x + component.pcbNameAt.x, y: at.y + component.pcbNameAt.y } } : {}),
    ...(component.pcbNameRotation !== undefined ? { nameRotation: component.pcbNameRotation } : {}),
    ...(component.pcbNameHidden ? { nameHidden: true as const } : {}),
  }
}

/** The parts with the sheet part each copies, for the parts of sub-sheet instances. */
function withCopies(circuit: Circuit, parts: readonly PlacedFootprint[]): PlacedFootprint[] {
  const sheets = new Map((circuit.instances ?? []).map((instance) => [instance.path, instance.sheet]))
  const byId = new Map(circuit.components.map((component) => [component.id, component]))
  return parts.map((part) => {
    const component = byId.get(part.component)
    const sheet = component?.instance === undefined ? undefined : sheets.get(component.instance)
    return sheet !== undefined && component?.localId !== undefined ? { ...part, copyOf: `${sheet}/${component.localId}` } : part
  })
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
    // The part is placed with the stub's pads, so the board can be laid out, but nothing is made from it.
    if (result.placeholder) diagnostics.push(diagnostic("footprint-placeholder", "error", placeholderMessage(component.id, result.name), [component.id], component.source))
    return { component, footprint: result }
  })
  return { resolved, diagnostics, missing }
}

/** "U3 uses a placeholder footprint; draw its pads in parts/J9/footprint.yaml" and how to clear it. */
function placeholderMessage(id: string, file: string): string {
  return `${id} uses a placeholder footprint; draw its pads in ${file} from the datasheet's land pattern, then delete "placeholder: true"`
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
  const board = usableOutline(circuit.board) && circuit.board ? boundsOf(circuit.board.outline) : undefined
  const unplaced = resolved.filter(({ component }) => !component.pcb).sort((a, b) => naturalCompare(a.component.id, b.component.id))
  const footprints = new Map(unplaced.map(({ component, footprint }) => [component.id, footprint]))
  // An instance's parts start at the instance's place; an instance without one keeps its parts together near its first.
  for (const group of anchorGroups(circuit, unplaced.map(({ component }) => component), "pcb")) {
    let near = group.anchor
    for (const component of group.parts) {
      const footprint = footprints.get(component.id)
      const relative = boundsOf(footprint?.courtyard ?? FALLBACK_COURTYARD)
      const spot = findSpot(relative, occupied, board, near)
      if (group.key !== "") near ??= spot
      const part = place(component, footprint, { ...AUTO_PLACEMENT, ...spot }, true, nets)
      byId.set(component.id, part)
      occupied.push(boundsOf(part.courtyard))
    }
  }
  return { parts: circuit.components.map((c) => byId.get(c.id) as PlacedFootprint) }
}

/**
 * Places the parts, resolves the layout file's copper (`records`, in file order), fills the pours with `fill` (none
 * without it) and draws what neither the copper nor the fill joins yet.
 */
export function layoutPcb(
  circuit: Circuit,
  footprintOf: FootprintOf,
  records: readonly LayoutRecord[] = [],
  fill?: PourFiller,
): { layout: PcbLayout; diagnostics: Diagnostic[] } {
  const { resolved, diagnostics, missing } = resolveFootprints(circuit, footprintOf)
  const parts = withCopies(circuit, placeAll(circuit, resolved, pinNets(circuit)).parts)
  if (missing.length > 0) {
    diagnostics.push(diagnostic("no-footprint", "warning", "These parts have no footprint and are drawn as 1 x 1 mm squares without pads", missing))
  }
  const { copper, pours, bare } = resolveWithPours(parts, records, circuit.nets, circuit.board?.layers ?? 2, fill, circuit.board?.graphics)
  const pourMade = pours.length === 0 ? [] : pourMadeConnections(parts, bare.islands, copper.islands)
  const layout: PcbLayout = {
    ...(circuit.board ? { board: circuit.board } : {}),
    parts,
    tracks: copper.tracks,
    vias: copper.vias,
    ratsnest: ratsnest(parts, copper.islands),
    ...(pourMade.length > 0 ? { pourMade } : {}),
    pours,
    holes: circuit.board?.holes ?? [],
    ...(circuit.board?.silkTexts ? { silkTexts: circuit.board.silkTexts } : {}),
    ...(circuit.board?.graphics ? { graphics: circuit.board.graphics } : {}),
  }
  return { layout, diagnostics: [...diagnostics, ...copper.diagnostics] }
}
