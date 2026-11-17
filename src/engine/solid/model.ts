// The board and its parts as solids, for the STEP file and the Studio's 3D view. Pure, and made only when asked for:
// nothing in an ordinary build calls it. The board is its outline (straight edges, as the outline holds them; a DXF's
// arcs arrive already as short straight edges) extruded from z = 0 to its thickness, with every mounting hole and
// every through-hole pad's drill through it (round drills as circles, oval drills as slots); vias are left out. Each
// part is a box on its courtyard's bounding rectangle in its own frame, turned and mirrored as the part is, standing on
// the top of the board or hanging below its bottom, as tall as partHeight says.
import type { Design } from "../design.js"
import type { Footprint, Pad } from "../footprints/types.js"
import type { Point } from "../model.js"
import type { PlacedFootprint } from "../pcb.js"
import { partHeight, type HeightState } from "./heights.js"
import { boardThickness } from "./thickness.js"

/** A straight edge, or an arc around `centre` that turns counter-clockwise (seen from +z) when `ccw`, clockwise if not. */
export type Segment = { kind: "line"; from: Point; to: Point } | { kind: "arc"; from: Point; to: Point; centre: Point; radius: number; ccw: boolean }

export interface BoardSolid {
  /** Counter-clockwise seen from the top. */
  outline: Segment[]
  /** Each clockwise seen from the top. */
  holes: Segment[][]
  thickness: number
}

export interface PartSolid {
  /** The designator. */
  name: string
  side: "top" | "bottom"
  /** The box's footprint on the board, counter-clockwise seen from the top. */
  corners: [Point, Point, Point, Point]
  /** The box's lowest and highest z, in mm; the board's bottom is z = 0. */
  bottom: number
  top: number
  height: number
  /** Where the height comes from: "given", "assumed", or the height table's source. */
  source: string
  state: HeightState
  assumed: boolean
}

export interface SolidModel {
  /** Absent when the design has no board with an outline. */
  board?: BoardSolid
  parts: PartSolid[]
}

/** A part without a footprint occupies this square (mm), as on the PCB. */
const FALLBACK_HALF = 0.5

/** Twice the signed area of a polygon, positive when counter-clockwise. */
function doubledArea(points: readonly Point[]): number {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point
    const q = points[(i + 1) % points.length] as Point
    sum += p.x * q.y - q.x * p.y
  }
  return sum
}

/** The sweep of an arc segment, in radians: positive counter-clockwise, in (0, 2π] either way. */
export function arcSweep(segment: Extract<Segment, { kind: "arc" }>): number {
  const { from, to, centre, ccw } = segment
  const start = Math.atan2(from.y - centre.y, from.x - centre.x)
  const end = Math.atan2(to.y - centre.y, to.x - centre.x)
  let sweep = ccw ? end - start : start - end
  while (sweep <= 1e-12) sweep += 2 * Math.PI
  while (sweep > 2 * Math.PI + 1e-12) sweep -= 2 * Math.PI
  return ccw ? sweep : -sweep
}

/** The signed area a closed loop of segments encloses, positive when it runs counter-clockwise. */
export function loopArea(loop: readonly Segment[]): number {
  let sum = 0
  for (const segment of loop) {
    sum += (segment.from.x * segment.to.y - segment.to.x * segment.from.y) / 2
    if (segment.kind === "arc") {
      // The circular segment between the chord and the arc: r²(θ − sin θ)/2, signed with the turn.
      const theta = arcSweep(segment)
      sum += (segment.radius ** 2 * (theta - Math.sin(theta))) / 2
    }
  }
  return sum
}

const lines = (points: readonly Point[]): Segment[] => points.map((from, i) => ({ kind: "line", from, to: points[(i + 1) % points.length] as Point }))

/** A round hole as two half circles, clockwise seen from the top. */
function circleHole(centre: Point, radius: number): Segment[] {
  const east = { x: centre.x + radius, y: centre.y }
  const west = { x: centre.x - radius, y: centre.y }
  return [
    { kind: "arc", from: east, to: west, centre, radius, ccw: false },
    { kind: "arc", from: west, to: east, centre, radius, ccw: false },
  ]
}

/** An oval drill as a slot: two half circles joined by straight sides, clockwise seen from the top. */
function slotHole(pad: Pad, drill: { width: number; height: number }): Segment[] {
  const radius = Math.min(drill.width, drill.height) / 2
  const half = Math.abs(drill.width - drill.height) / 2
  const along = ((pad.rotation + (drill.width >= drill.height ? 0 : 90)) * Math.PI) / 180
  const [ux, uy] = [Math.cos(along), Math.sin(along)]
  const at = (s: number, t: number): Point => ({ x: pad.x + ux * s - uy * t, y: pad.y + uy * s + ux * t })
  const [a, b] = [at(half, 0), at(-half, 0)]
  // Clockwise: along the bottom side from a to b, round b's end, back along the top side, round a's end.
  return [
    { kind: "line", from: at(half, -radius), to: at(-half, -radius) },
    { kind: "arc", from: at(-half, -radius), to: at(-half, radius), centre: b, radius, ccw: false },
    { kind: "line", from: at(-half, radius), to: at(half, radius) },
    { kind: "arc", from: at(half, radius), to: at(half, -radius), centre: a, radius, ccw: false },
  ]
}

function drillHole(pad: Pad): Segment[] | undefined {
  const drill = pad.drill
  if (pad.layers !== "through" || drill === undefined || !(drill.width > 0 && drill.height > 0)) return undefined
  return drill.width === drill.height ? circleHole(pad, drill.width / 2) : slotHole(pad, drill)
}

function boardSolid(design: Design, thickness: number): BoardSolid | undefined {
  const board = design.pcb.board
  if (board === undefined || board.outline.length < 3) return undefined
  const outline = doubledArea(board.outline) < 0 ? [...board.outline].reverse() : board.outline
  const drills = design.pcb.parts.flatMap((part) => part.pads.flatMap((pad) => {
    const hole = drillHole(pad)
    return hole === undefined ? [] : [hole]
  }))
  const mounting = design.pcb.holes.map((hole) => circleHole(hole, hole.diameter / 2))
  return { outline: lines(outline), holes: [...mounting, ...drills], thickness }
}

/** The rectangle the part's box stands on, in the part's own frame: its courtyard's bounds, else its pads'. */
function localBounds(footprint: Footprint | undefined): { minX: number; minY: number; maxX: number; maxY: number } {
  if (footprint === undefined) return { minX: -FALLBACK_HALF, minY: -FALLBACK_HALF, maxX: FALLBACK_HALF, maxY: FALLBACK_HALF }
  const points = footprint.courtyard.length >= 3 ? footprint.courtyard : footprint.pads.flatMap(padCorners)
  if (points.length === 0) return localBounds(undefined)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

function padCorners(pad: Pad): Point[] {
  const radians = (pad.rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const [dx, dy] = [((sx as number) * pad.width) / 2, ((sy as number) * pad.height) / 2]
    return { x: pad.x + dx * cos - dy * sin, y: pad.y + dx * sin + dy * cos }
  })
}

/** Turn counter-clockwise, mirror x on the bottom side, then move: as the PCB places a footprint. */
function placed(point: Point, part: PlacedFootprint): Point {
  const radians = (part.rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
  const [rx, ry] = [point.x * cos - point.y * sin, point.x * sin + point.y * cos]
  return { x: part.x + (part.side === "bottom" ? -rx : rx), y: part.y + ry }
}

function partSolid(part: PlacedFootprint, props: Readonly<Record<string, unknown>>, footprintText: string | undefined, thickness: number): PartSolid {
  const { minX, minY, maxX, maxY } = localBounds(part.footprint)
  const local: Point[] = [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ]
  const world = local.map((p) => placed(p, part))
  const corners = (doubledArea(world) < 0 ? [world[0], world[3], world[2], world[1]] : world) as [Point, Point, Point, Point]
  const { height, source, state, assumed } = partHeight({ ...(footprintText === undefined ? {} : { footprint: footprintText }), props })
  const [bottom, top] = part.side === "top" ? [thickness, thickness + height] : [-height, 0]
  return { name: part.component, side: part.side, corners, bottom, top, height, source, state, assumed }
}

/** The board and every part of a built design as solids, at the thickness boardThickness gives. */
export function solidModel(design: Design): SolidModel {
  const thickness = boardThickness(design)
  const board = boardSolid(design, thickness)
  const components = new Map(design.circuit.components.map((component) => [component.id, component]))
  const parts = design.pcb.parts.map((part) => {
    const component = components.get(part.component)
    return partSolid(part, component?.props ?? {}, component?.footprint, thickness)
  })
  return { ...(board ? { board } : {}), parts }
}

/** The board's volume: its outline's area less its holes', times its thickness. */
export function boardVolume(board: BoardSolid): number {
  return (loopArea(board.outline) + board.holes.reduce((sum, hole) => sum + loopArea(hole), 0)) * board.thickness
}

export function partVolume(part: PartSolid): number {
  return (doubledArea(part.corners) / 2) * (part.top - part.bottom)
}
