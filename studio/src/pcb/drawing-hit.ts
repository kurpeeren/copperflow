// Where the pointer is on a schematic drawing, and what a selection box takes. A line, a shape's outline, an arc and a
// text are hit on what they draw; a filled rectangle or circle is also hit anywhere inside its fill, but that hit sits
// under the parts (gestures.ts targetAt), so a part drawn over a filled shape stays the thing picked. The box takes a
// drawing by its box (drawingBounds) and the direction rule of box-select.ts. Pure: plain TypeScript with .js imports.
import { drawingBounds } from "../../../src/engine/drawing-kinds.js"
import type { SchematicDrawing } from "../../../src/engine/model.js"
import { areasInBox, type BoxMode } from "./box-select.js"
import type { Box, Point } from "./geometry.js"
import { isFilled, MIN_TEXT_PX, strokeWidthOf } from "./drawing-style.js"
import { distanceToSegment } from "./wire-hit.js"

/** Where a point is on a drawing: on what it draws (its line or text), or inside a filled shape's wash. */
export type DrawingPlace = "line" | "inside"

/** The drawing under a point, and where on it. */
export interface DrawingHit {
  id: string
  place: DrawingPlace
}

const rad = (degrees: number): number => (degrees * Math.PI) / 180

/** The distance from `p` to a polyline. */
function toPolyline(points: readonly Point[], p: Point, closed = false): number {
  const ring = closed && points.length > 2 ? [...points, points[0] as Point] : points
  let best = Number.POSITIVE_INFINITY
  for (let i = 1; i < ring.length; i++) best = Math.min(best, distanceToSegment(p, ring[i - 1] as Point, ring[i] as Point))
  return best
}

/** Whether the angle of `p` about the centre lies on the arc's sweep, counter-clockwise from its start. */
function onSweep(p: Point, centre: Point, startAngle: number, endAngle: number): boolean {
  const turn = endAngle - startAngle
  if (Math.abs(turn) >= 360) return true
  const sweep = ((turn % 360) + 360) % 360
  const angle = (Math.atan2(p.y - centre.y, p.x - centre.x) * 180) / Math.PI
  return ((angle - startAngle) % 360 + 360) % 360 <= sweep
}

/** The distance from `p` to an arc: to its circle on the sweep, else to the nearer end. */
function toArc(drawing: Extract<SchematicDrawing, { kind: "arc" }>, p: Point): number {
  const centre = { x: drawing.x, y: drawing.y }
  if (onSweep(p, centre, drawing.startAngle, drawing.endAngle)) return Math.abs(Math.hypot(p.x - centre.x, p.y - centre.y) - drawing.radius)
  const end = (degrees: number) => ({ x: centre.x + drawing.radius * Math.cos(rad(degrees)), y: centre.y + drawing.radius * Math.sin(rad(degrees)) })
  const [a, b] = [end(drawing.startAngle), end(drawing.endAngle)]
  return Math.min(Math.hypot(p.x - a.x, p.y - a.y), Math.hypot(p.x - b.x, p.y - b.y))
}

const within = (box: Box, p: Point): boolean => p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY

/** The distance from `p` to a box: 0 anywhere on it. */
const toBox = (box: Box, p: Point): number => Math.hypot(Math.max(box.minX - p.x, 0, p.x - box.maxX), Math.max(box.minY - p.y, 0, p.y - box.maxY))

/** The distance from `p` to what the drawing draws; a text is at distance 0 anywhere on its box. */
function distanceTo(drawing: SchematicDrawing, p: Point): number {
  switch (drawing.kind) {
    case "path":
    case "bus":
      return toPolyline(drawing.points, p)
    case "rect": {
      const { x, y, width, height } = drawing
      return toPolyline([{ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }], p, true)
    }
    case "circle":
      return Math.abs(Math.hypot(p.x - drawing.x, p.y - drawing.y) - drawing.radius)
    case "arc":
      return toArc(drawing, p)
    case "text":
    case "junction":
      return toBox(drawingBounds(drawing), p)
  }
}

/** Whether `p` lies inside a filled rectangle's or circle's wash. */
function insideFill(drawing: SchematicDrawing, p: Point): boolean {
  if (!isFilled(drawing)) return false
  if (drawing.kind === "circle") return Math.hypot(p.x - drawing.x, p.y - drawing.y) <= drawing.radius
  return within(drawingBounds(drawing), p)
}

/**
 * Where `p` is on one drawing: on its line within `reach` of the line's edge (sheet units, the pointer's reach over
 * the camera's scale), inside its fill, or not on it.
 */
export function drawingPlace(drawing: SchematicDrawing, p: Point, reach: number): DrawingPlace | undefined {
  if (distanceTo(drawing, p) <= reach + strokeWidthOf(drawing) / 2) return "line"
  return insideFill(drawing, p) ? "inside" : undefined
}

/** Whether the drawing is drawn at this zoom (`scale`, CSS pixels per sheet unit): a text too small to write is not. */
const shownAt = (drawing: SchematicDrawing, scale: number | undefined): boolean => drawing.kind !== "text" || scale === undefined || drawing.fontSize * scale >= MIN_TEXT_PX

/**
 * The drawing under `p`: the one drawn last (on top) whose line is hit, else the one drawn last whose fill holds `p`.
 * With the zoom's `scale`, a text too small to be drawn is passed over.
 */
export function drawingAt(drawings: readonly SchematicDrawing[], p: Point, reach: number, scale?: number): DrawingHit | undefined {
  let inside: DrawingHit | undefined
  for (let i = drawings.length - 1; i >= 0; i--) {
    const drawing = drawings[i] as SchematicDrawing
    if (!shownAt(drawing, scale)) continue
    const place = drawingPlace(drawing, p, reach)
    if (place === "line") return { id: drawing.id, place }
    if (place === "inside" && !inside) inside = { id: drawing.id, place }
  }
  return inside
}

/** The box round what a drawing draws, its line's half width included: what the hover outlines and a box takes. */
export function drawingBox(drawing: SchematicDrawing): Box {
  const box = drawingBounds(drawing)
  const half = strokeWidthOf(drawing) / 2
  return { minX: box.minX - half, minY: box.minY - half, maxX: box.maxX + half, maxY: box.maxY + half }
}

/** Every drawing's box, by id, in the sheet's order. */
export function drawingAreas(drawings: readonly SchematicDrawing[]): { id: string; box: Box }[] {
  return drawings.map((drawing) => ({ id: drawing.id, box: drawingBox(drawing) }))
}

/** The ids of the drawings the box from `a` to `b` takes by the direction rule: wholly inside it, or touching it. */
export function drawingsInBox(areas: readonly { id: string; box: Box }[], a: Point, b: Point, mode: BoxMode): string[] {
  return areasInBox(areas, a, b, mode)
}
