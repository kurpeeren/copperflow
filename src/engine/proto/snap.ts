// The placer's positions moved onto a perfboard's or stripboard's holes: each part turned to a quarter turn (on
// stripboard the turn that puts its pins on the most strips, so a resistor lies across the strips, not along one), then
// moved so its pins drop into free holes, at the nearest such spot to where the placer put it, its body clear of the
// parts snapped before it. Larger parts go first. Pure.
import type { Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PlacedFootprint, PcbLayout } from "../pcb.js"
import type { PlacedPosition } from "../pcb-place/index.js"
import { inGrid, ON_HOLE, type Hole, type ProtoGrid } from "./grid.js"
import { pinHoles } from "./placement.js"

/** How far from the placer's spot a part is looked for a free place, in holes. */
const REACH = 12

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const turn = (p: Point, degrees: number): Point => {
  const r = (degrees * Math.PI) / 180
  const [cos, sin] = [Math.round(Math.cos(r)), Math.round(Math.sin(r))]
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }
}

const boxOf = (points: readonly Point[]): Box => ({
  minX: Math.min(...points.map((p) => p.x)),
  minY: Math.min(...points.map((p) => p.y)),
  maxX: Math.max(...points.map((p) => p.x)),
  maxY: Math.max(...points.map((p) => p.y)),
})
/** Overlap with a hair of slack, so bodies that only touch are fine. */
const overlaps = (a: Box, b: Box) => a.minX < b.maxX - 1e-6 && b.minX < a.maxX - 1e-6 && a.minY < b.maxY - 1e-6 && b.minY < a.maxY - 1e-6

/** The offsets in holes nearest first: by distance, then down, then across. */
const OFFSETS: readonly { dx: number; dy: number }[] = Array.from({ length: (2 * REACH + 1) ** 2 }, (_, i) => ({ dx: (i % (2 * REACH + 1)) - REACH, dy: Math.floor(i / (2 * REACH + 1)) - REACH })).sort(
  (a, b) => a.dx * a.dx + a.dy * a.dy - (b.dx * b.dx + b.dy * b.dy) || a.dy - b.dy || a.dx - b.dx,
)

/** The quarter turns to try: the placer's own rounded, and on stripboard the one putting the pins on more strips first. */
function turnsFor(grid: ProtoGrid, part: PlacedFootprint, rotation: number): number[] {
  const base = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360
  if (grid.kind !== "stripboard") return [base]
  const other = (base + 90) % 360
  const strips = (degrees: number) => new Set((part.footprint?.pads ?? []).map((pad) => Math.round((grid.strips === "columns" ? turn(pad, degrees).x : turn(pad, degrees).y) / grid.pitch))).size
  return strips(other) > strips(base) ? [other, base] : [base, other]
}

interface Taken {
  /** The lattice points used, as "col,row": they may lie past the board when it will be fitted round the parts. */
  holes: Set<string>
  bodies: Box[]
  /** Whether a part may go past the board's holes (the board is fitted round the parts afterwards). */
  unbounded: boolean
}

/** The lattice point nearest a point, not kept inside the board, and how far it is. */
function latticeHole(grid: ProtoGrid, p: Point): { hole: Hole; distance: number } {
  const hole = { col: Math.round((p.x - grid.first.x) / grid.pitch), row: Math.round((grid.first.y - p.y) / grid.pitch) }
  return { hole, distance: Math.hypot(p.x - (grid.first.x + hole.col * grid.pitch), p.y - (grid.first.y - hole.row * grid.pitch)) }
}

const latticeKey = (hole: Hole) => `${hole.col},${hole.row}`

/** Where the part goes at this turn, near `near`, its pins in free holes; undefined when nothing within reach is free. */
function spotFor(grid: ProtoGrid, part: PlacedFootprint, degrees: number, near: Point, taken: Taken): Point | undefined {
  const pads = (part.footprint?.pads ?? []).filter((pad) => pad.layers === "through").map((pad) => turn(pad, degrees))
  const first = pads[0]
  if (!first) return undefined
  const courtyard = (part.footprint?.courtyard ?? []).map((p) => turn(p, degrees))
  const anchor = latticeHole(grid, { x: near.x + first.x, y: near.y + first.y }).hole
  for (const { dx, dy } of OFFSETS) {
    const hole = { col: anchor.col + dx, row: anchor.row + dy }
    const origin = { x: grid.first.x + hole.col * grid.pitch - first.x, y: grid.first.y - hole.row * grid.pitch - first.y }
    const keys: string[] = []
    const fits = pads.every((pad) => {
      const at = latticeHole(grid, { x: origin.x + pad.x, y: origin.y + pad.y })
      const key = latticeKey(at.hole)
      keys.push(key)
      return at.distance <= ON_HOLE && !taken.holes.has(key) && (taken.unbounded || inGrid(grid, at.hole))
    })
    if (!fits) continue
    const body = courtyard.length >= 3 ? boxOf(courtyard.map((p) => ({ x: origin.x + p.x, y: origin.y + p.y }))) : undefined
    if (body && taken.bodies.some((other) => overlaps(body, other))) continue
    for (const key of keys) taken.holes.add(key)
    if (body) taken.bodies.push(body)
    return origin
  }
  return undefined
}

/** The positions moved onto the holes, and a note for each part left where the placer put it. */
export function snapPositions(layout: Pick<PcbLayout, "board" | "parts">, positions: ReadonlyMap<string, PlacedPosition>, options: { unbounded?: boolean } = {}): { positions: Map<string, PlacedPosition>; notes: string[] } {
  const grid = layout.board?.proto
  if (!grid) return { positions: new Map(positions), notes: [] }
  const moving = layout.parts.filter((part) => positions.has(part.component))
  const fixed = layout.parts.filter((part) => !positions.has(part.component) && !part.autoPlaced)
  const taken: Taken = {
    holes: new Set([...pinHoles(grid, fixed).values()].map(({ hole }) => latticeKey(hole))),
    bodies: fixed.filter((p) => p.courtyard.length >= 3).map((p) => boxOf(p.courtyard)),
    unbounded: options.unbounded === true,
  }
  const out = new Map(positions)
  const notes: string[] = []
  const order = [...moving].sort((a, b) => b.pads.length - a.pads.length || naturalCompare(a.component, b.component))
  for (const part of order) {
    const at = positions.get(part.component) as PlacedPosition
    if (!part.footprint?.pads.some((pad) => pad.layers === "through")) {
      notes.push(`${part.component} has no through-hole pins, so it was left where the placer put it`)
      continue
    }
    const placed = turnsFor(grid, part, at.rotation)
      .map((degrees) => ({ degrees, spot: spotFor(grid, part, degrees, at, taken) }))
      .find((one) => one.spot !== undefined)
    if (placed?.spot) out.set(part.component, { x: round(placed.spot.x), y: round(placed.spot.y), rotation: placed.degrees })
    else notes.push(`${part.component} found no free holes near where the placer put it; it was left there${taken.unbounded ? "" : " (fit: true grows the board)"}`)
  }
  return { positions: out, notes }
}

const round = (v: number) => Math.round(v * 10_000) / 10_000 || 0
