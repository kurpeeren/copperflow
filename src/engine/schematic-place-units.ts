// What placement moves as one: a passive, or a chain of them laid end to end, and the sheet that takes them
// without letting any two symbols come closer than CLEARANCE.
import { sheetBounds, snapDown, snapUp, tidy, turnedBounds, type Spot } from "./schematic-geometry.js"
import { isPair, type Link } from "./schematic-place-chains.js"
import type { Bounds, SchSymbol } from "./symbols/index.js"

/** The least room between any two symbols' bounds. */
export const CLEARANCE = 0.2
const EPSILON = 1e-9

export type Symbols = ReadonlyMap<string, SchSymbol>
export type Direction = "right" | "left" | "up" | "down"

/** One symbol of a unit, its spot relative to the unit's origin. */
export interface Piece {
  part: string
  bounds: Bounds
  spot: Spot
}

/** Symbols that move together; `box` is the union of their bounds, relative to the origin. */
export interface Unit {
  pieces: Piece[]
  box: Bounds
}

/** The quarter turn that points a chain's left end back along `direction`. */
const TURN: Readonly<Record<Direction, number>> = { right: 0, up: 90, left: 180, down: 270 }

const union = (boxes: readonly Bounds[]): Bounds => ({
  minX: Math.min(...boxes.map((b) => b.minX)),
  minY: Math.min(...boxes.map((b) => b.minY)),
  maxX: Math.max(...boxes.map((b) => b.maxX)),
  maxY: Math.max(...boxes.map((b) => b.maxY)),
})

/** Where the next piece's origin goes along the axis, `gap` past the far edge `cursor` of the one before. */
function along(direction: Direction, cursor: number, gap: number, turned: Bounds): number {
  if (direction === "right") return snapUp(cursor + gap - turned.minX)
  if (direction === "left") return snapDown(cursor - gap - turned.maxX)
  if (direction === "up") return snapUp(cursor + gap - turned.minY)
  return snapDown(cursor - gap - turned.maxY)
}

const farEdge = (direction: Direction, box: Bounds): number =>
  direction === "right" ? box.maxX : direction === "left" ? box.minX : direction === "up" ? box.maxY : box.minY

/**
 * The links laid end to end from the origin along `direction`, `gap` apart, the first one's left end facing back
 * toward the origin. Two-pin parts that are not drawn as a pair keep rotation 0.
 */
export function unitOf(links: readonly Link[], direction: Direction, gap: number, symbols: Symbols): Unit {
  const pieces: Piece[] = []
  let cursor = 0
  for (const link of links) {
    const symbol = symbols.get(link.part.id)
    if (!symbol) continue
    const rotation = isPair(symbol) ? (link.rotation + TURN[direction]) % 360 : 0
    const turned = turnedBounds(symbol.bounds, rotation)
    const offset = pieces.length === 0 ? 0 : along(direction, cursor, gap, turned)
    const flat = direction === "right" || direction === "left"
    const spot = { x: flat ? offset : 0, y: flat ? 0 : offset, rotation }
    pieces.push({ part: link.part.id, bounds: symbol.bounds, spot })
    cursor = farEdge(direction, sheetBounds(symbol.bounds, spot))
  }
  const box = pieces.length > 0 ? union(pieces.map((p) => sheetBounds(p.bounds, p.spot))) : { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return { pieces, box }
}

export const crowds = (a: Bounds, b: Bounds): boolean =>
  a.minX < b.maxX + CLEARANCE - EPSILON &&
  b.minX < a.maxX + CLEARANCE - EPSILON &&
  a.minY < b.maxY + CLEARANCE - EPSILON &&
  b.minY < a.maxY + CLEARANCE - EPSILON

const at = (piece: Piece, origin: Spot): Spot => ({ x: tidy(origin.x + piece.spot.x), y: tidy(origin.y + piece.spot.y), rotation: piece.spot.rotation })

/** The origin moved along `push` just far enough for `box`, a piece's box at that origin, to clear `hit`. */
function cleared(origin: Spot, box: Bounds, hit: Bounds, push: Direction): Spot {
  if (push === "down") return { ...origin, y: snapDown(origin.y + hit.minY - CLEARANCE - box.maxY) }
  if (push === "up") return { ...origin, y: snapUp(origin.y + hit.maxY + CLEARANCE - box.minY) }
  if (push === "left") return { ...origin, x: snapDown(origin.x + hit.minX - CLEARANCE - box.maxX) }
  return { ...origin, x: snapUp(origin.x + hit.maxX + CLEARANCE - box.minX) }
}

/** What has been placed so far, fixed parts first. */
export class Sheet {
  readonly boxes: Bounds[]
  readonly spots = new Map<string, Spot>()

  constructor(fixed: readonly Bounds[]) {
    this.boxes = [...fixed]
  }

  /**
   * Puts the unit at the origin, or moved along `push`: past each box one of its pieces would crowd, until none
   * does. The origin only ever moves one way, so no box is hit twice and the loop ends. Returns the origin used.
   */
  put(unit: Unit, origin: Spot, push: Direction = "down"): Spot {
    let current = origin
    for (let hit = this.crowding(unit, current); hit; hit = this.crowding(unit, current)) {
      current = cleared(current, hit.box, hit.other, push)
    }
    for (const piece of unit.pieces) {
      const spot = at(piece, current)
      this.boxes.push(sheetBounds(piece.bounds, spot))
      this.spots.set(piece.part, spot)
    }
    return current
  }

  right(): number | undefined {
    return this.boxes.length > 0 ? Math.max(...this.boxes.map((box) => box.maxX)) : undefined
  }

  /** The first piece's box on the sheet that crowds a placed box, and that box. */
  private crowding(unit: Unit, origin: Spot): { box: Bounds; other: Bounds } | undefined {
    for (const piece of unit.pieces) {
      const placed = sheetBounds(piece.bounds, at(piece, origin))
      const other = this.boxes.find((box) => crowds(placed, box))
      if (other) return { box: placed, other }
    }
    return undefined
  }
}
