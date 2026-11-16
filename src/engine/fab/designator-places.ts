// The places a designator may take round its part, and what is in the way of each: the geometry behind
// designators.ts. A place is beside one side of the courtyard, centred or slid along it, at the silkscreen clearance
// (then a little further out), its text running along that side. What is in the way: pads' mask openings, holes and
// vias, other parts' courtyards, designators already placed, and the board's edge. Pure.
import { pointInPolygon } from "../checks/geometry.js"
import type { Point } from "../model.js"
import type { PlacedFootprint, WorldPad } from "../pcb.js"
import { textWidth } from "./stroke-font.js"

/** The silkscreen line width, in mm: JLCPCB's minimum legible line. */
export const SILK_WIDTH = 0.15
/** The silkscreen designator's height, in mm: JLCPCB's minimum legible character height. */
export const DESIGNATOR_HEIGHT = 1

/** A designator's turn: 0 reads left to right, 90 reads from the bottom up (from the board's right edge). */
export type DesignatorTurn = 0 | 90

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface Place {
  /** The middle of the text. */
  at: Point
  rotation: DesignatorTurn
  /**
   * The text's box stretched back to its part's courtyard: no other part's courtyard may lie in it, so no part stands
   * between a designator and its own part. Absent on a place a person chose.
   */
  reach?: Box
}

/** How much further out than the clearance the outer rings of places sit, in mm; the last stays within 2 mm. */
const RINGS = [0, 0.4, 0.8, 1.2, 1.6]
/** The step a place slides along a side, in mm. */
const SLIDE_STEP = 0.5
/** At most this many steps each way along a long side: a long part's name needs no finer choice. */
const MAX_SLIDES = 4
/** Grid cell of the obstacle index, in mm: about a small part. */
const CELL = 2
/**
 * What covering each kind of thing costs: each pad, hole, via or designator covered costs its weight and the weight
 * again per mm² covered, so covering one more of them always costs more than any part body; a courtyard costs by area.
 */
const WEIGHT = { pad: 100, hole: 100, via: 50, designator: 100, courtyard: 2, edge: 1000 } as const
/** What another part standing between a designator and its own part costs, whatever the overlap. */
export const BETWEEN = 1

export const overlap = (a: Box, b: Box) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY))
const hull = (a: Box, b: Box): Box => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) })
const grown = (box: Box, by: number): Box => ({ minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by })

/** The box the designator's ink covers when centred on `at`, the stroke's half width included, turned or not. */
export function textBox(text: string, at: Point, rotation: DesignatorTurn = 0): Box {
  const long = textWidth(text, DESIGNATOR_HEIGHT) / 2 + SILK_WIDTH / 2
  const short = DESIGNATOR_HEIGHT / 2 + SILK_WIDTH / 2
  const [halfX, halfY] = rotation === 90 ? [short, long] : [long, short]
  return { minX: at.x - halfX, minY: at.y - halfY, maxX: at.x + halfX, maxY: at.y + halfY }
}

/** The box around a pad's mask opening, turned with the pad: the pad grown by the expansion on every side. */
export function maskBox(pad: WorldPad, expansion: number): Box {
  const radians = (pad.rotation * Math.PI) / 180
  const [cos, sin] = [Math.abs(Math.cos(radians)), Math.abs(Math.sin(radians))]
  const [w, h] = [pad.width / 2 + expansion, pad.height / 2 + expansion]
  const [dx, dy] = pad.shape === "circle" ? [w, w] : [w * cos + h * sin, w * sin + h * cos]
  return { minX: pad.x - dx, minY: pad.y - dy, maxX: pad.x + dx, maxY: pad.y + dy }
}

export function boxOf(points: readonly Point[]): Box {
  const xs = points.map((c) => c.x)
  const ys = points.map((c) => c.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/**
 * Offsets along a side of `half` length for a text of `textHalf`: centred, either end lined up, and in steps up to the
 * text centred on a corner.
 */
function slides(half: number, textHalf: number): number[] {
  const end = Math.abs(half - textHalf)
  const reach = Math.max(half, end)
  const step = Math.max(SLIDE_STEP, reach / MAX_SLIDES)
  const steps = Array.from({ length: Math.floor(reach / step) }, (_, i) => (i + 1) * step)
  const all = [0, end, half, ...steps].flatMap((v) => [-v, v]).map((v) => Math.round(v * 1e6) / 1e6 + 0)
  return [...new Set(all)]
}

/**
 * The places tried for a part's designator, nearest to the part first: beside each side of its courtyard, centred and
 * slid along it, at the clearance and a little further out. Beside the top or bottom the text lies flat; beside the
 * left or right it stands, so it runs along the side it is beside. After all of those come the same places with the
 * other turn, for a crowded part. `turn` forces one turn on every side.
 */
export function placesAround(part: PlacedFootprint, clearance: number, turn?: DesignatorTurn): Place[] {
  if (turn !== undefined) return sidePlaces(part, clearance, () => turn)
  return [...sidePlaces(part, clearance, (flat) => (flat ? 0 : 90)), ...sidePlaces(part, clearance, (flat) => (flat ? 90 : 0))]
}

/** The places beside each side, nearest first, the text turned as `turnFor` says for a flat (top or bottom) side or not. */
function sidePlaces(part: PlacedFootprint, clearance: number, turnFor: (flat: boolean) => DesignatorTurn): Place[] {
  if (part.courtyard.length === 0) return [{ at: { x: part.x, y: part.y }, rotation: turnFor(true) }]
  const box = boxOf(part.courtyard)
  const [cx, cy] = [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2]
  const [halfW, halfH] = [(box.maxX - box.minX) / 2, (box.maxY - box.minY) / 2]
  const long = textWidth(part.component, DESIGNATOR_HEIGHT) / 2 + SILK_WIDTH / 2
  const short = DESIGNATOR_HEIGHT / 2 + SILK_WIDTH / 2
  const found: Place[] = []
  for (const ring of RINGS) {
    const gap = clearance + ring
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const flat = side === "top" || side === "bottom"
      const rotation = turnFor(flat)
      const [alongHalf, acrossHalf] = (rotation === 0) === flat ? [long, short] : [short, long]
      if (flat) {
        const top = side === "top"
        const y = top ? box.maxY + gap + acrossHalf : box.minY - gap - acrossHalf
        const [low, high] = top ? [box.maxY, y + acrossHalf] : [y - acrossHalf, box.minY]
        for (const dx of slides(halfW, alongHalf)) {
          found.push({ at: { x: cx + dx, y }, rotation, reach: { minX: cx + dx - alongHalf, maxX: cx + dx + alongHalf, minY: low, maxY: high } })
        }
      } else {
        const right = side === "right"
        const x = right ? box.maxX + gap + acrossHalf : box.minX - gap - acrossHalf
        const [low, high] = right ? [box.maxX, x + acrossHalf] : [x - acrossHalf, box.minX]
        for (const dy of slides(halfH, alongHalf)) {
          found.push({ at: { x, y: cy + dy }, rotation, reach: { minX: low, maxX: high, minY: cy + dy - alongHalf, maxY: cy + dy + alongHalf } })
        }
      }
    }
  }
  // Rounded, so the copies of a part, which differ only by where they are, list their places in the same order.
  const distance = (p: Place) => Math.round(Math.hypot(p.at.x - cx, p.at.y - cy) * 1e3)
  return found.map((place, i) => ({ place, i, d: distance(place) })).sort((a, b) => a.d - b.d || a.i - b.i).map((entry) => entry.place)
}

type Kind = keyof typeof WEIGHT
interface Obstacle {
  kind: Kind
  /** The part it belongs to; "" for vias and holes. */
  component: string
  side: "top" | "bottom" | "both"
  box: Box
  /** The last query that met it, so a query lists it once. */
  seen?: number
  /** Set on a designator taken off to be placed again; the index keeps it but nothing sees it. */
  gone?: true
}

/** What a place covers, by kind: the parts named (pads, courtyards, designators), and whether a via, hole or the edge. */
export interface Covered {
  pads: string[]
  designators: string[]
  courtyards: string[]
  vias: boolean
  holes: boolean
  edge: boolean
  /** The weighed overlap: 0 when the place is clear. */
  score: number
  /** The part of `score` that is not other designators: 0 when only designators are in the way. */
  fixed: number
  /** How many other parts stand between the text and its own part (part of `score`, not of `fixed`). */
  between: number
}

/** Everything a designator must keep off, and the designators placed so far. */
export class SilkObstacles {
  /** Pads, holes, vias and courtyards: they never move, so what a place covers of them is worked out once. */
  private readonly fixedIndex = new CellIndex()
  /** The designators placed so far. */
  private readonly textIndex = new CellIndex()
  private readonly designators = new Map<string, Obstacle>()
  private readonly fixedOf = new WeakMap<Place, Covered>()

  constructor(
    private readonly outline: readonly Point[] | undefined,
    private readonly clearance: number,
  ) {}

  add(kind: Kind, component: string, side: Obstacle["side"], box: Box): void {
    const obstacle: Obstacle = { kind, component, side, box }
    if (kind !== "designator") {
      this.fixedIndex.insert(obstacle, box)
      return
    }
    this.remove(component)
    this.designators.set(component, obstacle)
    this.textIndex.insert(obstacle, box)
  }

  /** Takes a part's designator off, so it can be placed again. */
  remove(component: string): void {
    const placed = this.designators.get(component)
    if (placed) placed.gone = true
    this.designators.delete(component)
  }

  /** What the text of `part` at `place` covers; with `spaced`, designators closer than the clearance count too. */
  covered(part: PlacedFootprint, place: Place, spaced = true): Covered {
    const box = textBox(part.component, place.at, place.rotation)
    const near = spaced ? grown(box, this.clearance) : box
    const known = spaced ? this.fixedOf.get(place) : undefined
    const fixed = known ?? this.fixedCovered(part, place, box, spaced)
    if (spaced && !known) this.fixedOf.set(place, fixed)
    const found: Covered = { ...fixed, pads: [...fixed.pads], courtyards: [...fixed.courtyards], designators: [] }
    for (const obstacle of this.textIndex.query(near)) {
      if (obstacle.gone || obstacle.side !== part.side || obstacle.component === part.component || !overlap(near, obstacle.box)) continue
      found.score += WEIGHT.designator * (1 + overlapArea(near, obstacle.box))
      found.designators.push(obstacle.component)
    }
    return found
  }

  /** What the text covers of the things that never move, and whether it leaves the board. */
  private fixedCovered(part: PlacedFootprint, place: Place, box: Box, spaced: boolean): Covered {
    const reach = place.reach ?? box
    const found: Covered = { pads: [], designators: [], courtyards: [], vias: false, holes: false, edge: false, score: 0, fixed: 0, between: 0 }
    for (const obstacle of this.fixedIndex.query(spaced ? hull(box, reach) : box)) {
      if (obstacle.side !== "both" && obstacle.side !== part.side) continue
      if (obstacle.component === part.component && obstacle.kind !== "pad") continue
      const between = obstacle.kind === "courtyard" && spaced && !overlap(box, obstacle.box) && overlap(reach, obstacle.box)
      if (!between && !overlap(box, obstacle.box)) continue
      const area = overlapArea(box, obstacle.box)
      const weight = between ? BETWEEN : WEIGHT[obstacle.kind] * (obstacle.kind === "courtyard" ? Math.max(area, 1e-3) : 1 + area)
      found.score += weight
      if (between) found.between += 1
      else found.fixed += weight
      if (between) continue
      if (obstacle.kind === "pad") found.pads.push(obstacle.component)
      else if (obstacle.kind === "courtyard") found.courtyards.push(obstacle.component)
      else if (obstacle.kind === "via") found.vias = true
      else found.holes = true
    }
    if (this.outline && !insideOutline(box, this.outline)) {
      found.edge = true
      found.score += WEIGHT.edge
      found.fixed += WEIGHT.edge
    }
    return found
  }
}

/** Obstacles by the grid cells their boxes touch; a query visits each one once. Plain and fast: it runs per place tried. */
class CellIndex {
  private readonly cells = new Map<number, Obstacle[]>()
  private stamp = 0

  private static key(x: number, y: number): number {
    return (x + 32768) * 65536 + (y + 32768)
  }

  insert(obstacle: Obstacle, box: Box): void {
    for (let x = Math.floor(box.minX / CELL); x <= Math.floor(box.maxX / CELL); x++) {
      for (let y = Math.floor(box.minY / CELL); y <= Math.floor(box.maxY / CELL); y++) {
        const key = CellIndex.key(x, y)
        const items = this.cells.get(key)
        if (items) items.push(obstacle)
        else this.cells.set(key, [obstacle])
      }
    }
  }

  query(box: Box): Obstacle[] {
    const stamp = ++this.stamp
    const found: Obstacle[] = []
    for (let x = Math.floor(box.minX / CELL); x <= Math.floor(box.maxX / CELL); x++) {
      for (let y = Math.floor(box.minY / CELL); y <= Math.floor(box.maxY / CELL); y++) {
        for (const obstacle of this.cells.get(CellIndex.key(x, y)) ?? []) {
          if (obstacle.seen === stamp) continue
          obstacle.seen = stamp
          found.push(obstacle)
        }
      }
    }
    return found
  }
}

/** Whether the box lies inside the outline: its corners inside and no corner of the outline within it. */
function insideOutline(box: Box, outline: readonly Point[]): boolean {
  const corners = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ]
  if (!corners.every((corner) => pointInPolygon(corner, outline))) return false
  return !outline.some((p) => p.x > box.minX && p.x < box.maxX && p.y > box.minY && p.y < box.maxY)
}
