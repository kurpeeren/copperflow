// The one place a drawing read from an SVG or DXF file (graphics/index.ts) becomes board geometry: its shapes scaled,
// centred on the placement, turned, and on the bottom side mirrored left to right after the turn (as a bottom text
// is), so it reads right when the board is turned over. Filled shapes are united into areas with their holes; lines
// keep their own width scaled, or take the typical minimum when the file gives none. Every output (the Gerber files,
// and through them the pictures, the 3D texture, the GLB and the HTML page; the Studio's PCB view; the checks) uses
// what this returns. Pure.
import earcut from "earcut"
import type { GraphicShapes } from "./graphics/index.js"
import type { BoardGraphic, Point } from "./model.js"
import { regions, toPath, toPoints } from "./pour/clip.js"

/**
 * The line width a stroke gets when its file gives none, in mm: the thinnest silkscreen line board houses commonly
 * print (a typical figure from common fabrication guidelines; the fabrication profiles set no silkscreen width).
 */
export const MIN_GRAPHIC_LINE_WIDTH = 0.15

export interface GraphicPlacement {
  x: number
  y: number
  /** How many board mm one mm of the drawing becomes. */
  scale: number
  rotation: number
  bottom: boolean
  /** Whether closed lines are filled (a DXF outline carries no fill of its own). */
  fill: boolean
}

/** The most closed outlines one drawing fills; the rest are left out and said so (each is tested against larger ones). */
export const MAX_FILLED_OUTLINES = 10_000

type Placed = Pick<BoardGraphic, "areas" | "lines" | "width" | "height" | "skipped">

/** The function that takes a point of the drawing to the board. */
function mover(shapes: Pick<GraphicShapes, "width" | "height">, at: GraphicPlacement): (p: Point) => Point {
  const radians = (at.rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
  const side = at.bottom ? -1 : 1
  return (p) => {
    const [lx, ly] = [(p.x - shapes.width / 2) * at.scale, (p.y - shapes.height / 2) * at.scale]
    return { x: at.x + side * (lx * cos - ly * sin), y: at.y + lx * sin + ly * cos }
  }
}

/** Twice the signed area of a ring; positive when counter-clockwise. */
function ringArea(ring: readonly Point[]): number {
  return ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length] as Point
    return sum + a.x * b.y - b.x * a.y
  }, 0)
}

function inside(p: Point, ring: readonly Point[]): boolean {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = [ring[i] as Point, ring[j] as Point]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
  }
  return hit
}

interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

function boxOf(ring: readonly Point[]): Box {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const p of ring) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

const holds = (outer: Box, inner: Box) => outer.minX <= inner.minX && outer.minY <= inner.minY && outer.maxX >= inner.maxX && outer.maxY >= inner.maxY

/**
 * Closed lines filled the even-odd way: a ring inside an odd number of others is a hole, wound clockwise. Largest
 * first, so a ring is tested only against larger ones, and only those whose box holds its box.
 */
function closedLinesAsRings(rings: readonly Point[][]): Point[][] {
  const facts = rings.map((ring) => ({ ring, area: ringArea(ring), box: boxOf(ring) })).sort((a, b) => Math.abs(b.area) - Math.abs(a.area))
  return facts.map((one, i) => {
    let depth = 0
    for (let j = 0; j < i; j++) {
      const other = facts[j] as (typeof facts)[number]
      if (holds(other.box, one.box) && inside(one.ring[0] as Point, other.ring)) depth++
    }
    return one.area > 0 === (depth % 2 === 0) ? one.ring : [...one.ring].reverse()
  })
}

/** Every ring united by the non-zero rule into areas, each with its holes. */
function unite(rings: readonly Point[][]): Placed["areas"] {
  const paths = rings.filter((ring) => ring.length >= 3).map(toPath)
  if (paths.length === 0) return []
  return regions(paths).map((piece) => ({ outer: toPoints(piece.outer), holes: piece.holes.map(toPoints) }))
}

/** The drawing's shapes on the board at this placement. */
export function placeGraphic(shapes: GraphicShapes, at: GraphicPlacement): Placed {
  const move = mover(shapes, at)
  const closed = at.fill ? shapes.strokes.filter((stroke) => stroke.closed && stroke.points.length >= 3) : []
  const filledLines = closed.slice(0, MAX_FILLED_OUTLINES)
  const dropped = new Set(closed.slice(MAX_FILLED_OUTLINES))
  const filled = new Set(filledLines)
  const fillRings = shapes.fills.flatMap((fill) => [fill.outer, ...fill.holes])
  const rings = [...fillRings, ...closedLinesAsRings(filledLines.map((stroke) => stroke.points))].map((ring) => ring.map(move))
  const skipped = dropped.size === 0 ? [] : [`${dropped.size} closed outlines beyond the ${MAX_FILLED_OUTLINES} filled`]
  const lines = shapes.strokes
    .filter((stroke) => !filled.has(stroke) && !dropped.has(stroke) && stroke.points.length > 0)
    .map((stroke) => ({
      points: (stroke.closed ? [...stroke.points, stroke.points[0] as Point] : stroke.points).map(move),
      width: stroke.width > 0 ? stroke.width * at.scale : MIN_GRAPHIC_LINE_WIDTH,
    }))
  return { areas: unite(rings), lines, width: shapes.width * at.scale, height: shapes.height * at.scale, skipped }
}

/** The box round everything a drawing puts on the board, its lines' half widths included. */
export function graphicBox(graphic: Pick<BoardGraphic, "areas" | "lines" | "x" | "y">): { minX: number; minY: number; maxX: number; maxY: number } {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  const grow = (p: Point, half: number) => {
    box.minX = Math.min(box.minX, p.x - half)
    box.minY = Math.min(box.minY, p.y - half)
    box.maxX = Math.max(box.maxX, p.x + half)
    box.maxY = Math.max(box.maxY, p.y + half)
  }
  for (const area of graphic.areas) for (const p of area.outer) grow(p, 0)
  for (const line of graphic.lines) for (const p of line.points) grow(p, line.width / 2)
  return Number.isFinite(box.minX) ? box : { minX: graphic.x, minY: graphic.y, maxX: graphic.x, maxY: graphic.y }
}

/** The most triangles a drawing on copper may be cut into: each is a piece the checks and the router look at. */
export const MAX_COPPER_TRIANGLES = 5000

/** The filled areas cut into triangles, each hole left open: shapes without holes, as the copper checks measure. */
export function triangulate(areas: BoardGraphic["areas"]): Point[][] {
  return areas.flatMap((area) => {
    const rings = [area.outer, ...area.holes]
    const flat = rings.flatMap((ring) => ring.flatMap((p) => [p.x, p.y]))
    const starts: number[] = []
    let count = area.outer.length
    for (const hole of area.holes) {
      starts.push(count)
      count += hole.length
    }
    const points = rings.flat()
    const cut = earcut(flat, starts, 2)
    const triangles: Point[][] = []
    for (let i = 0; i + 2 < cut.length; i += 3) triangles.push([points[cut[i] as number], points[cut[i + 1] as number], points[cut[i + 2] as number]] as Point[])
    return triangles
  })
}
