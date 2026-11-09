// A schematic wire's hover outline and its selection handles, drawn over the sheet in CSS pixels: the outline is the
// dashed one a hovered part gets, 3 px round the wire; a selected wire (drawn red by schematic-draw.ts) gets white
// squares on its corners and hollow squares on its two ends, which stay on their pins. Plain TypeScript, so the tests can run it.
import { worldToScreen, type Camera, type Point, type Size } from "./geometry.js"
import { schematicTheme } from "./schematic-theme.js"
import { pastStrokePx, wireHandles } from "./wire-hit.js"

/** The colours of a wire's hover outline and handles. */
export interface WireLook {
  hover: string
  selected: string
  handleFill: string
}

export const SHEET_WIRE_LOOK: WireLook = { hover: schematicTheme.hover, selected: schematicTheme.selection, handleFill: schematicTheme.handleFill }

/** The side of a handle, in CSS pixels. */
export const WIRE_HANDLE_PX = 6
/** How far the hover outline stands off the wire, as a hovered part's outline does; at deep zoom, off the stroke's edge. */
const OUTLINE_PAD_PX = 3

/** The hover outline's distance from the wire's centre line at this zoom, in CSS pixels. */
export const wireHoverPadPx = (scale: number): number => pastStrokePx(OUTLINE_PAD_PX, scale)
const OUTLINE_DASH = [4, 3]

const unit = (a: Point, b: Point): Point => {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  return { x: (b.x - a.x) / length, y: (b.y - a.y) / length }
}
const normal = (d: Point): Point => ({ x: -d.y, y: d.x })
const along = (p: Point, d: Point, by: number): Point => ({ x: p.x + d.x * by, y: p.y + d.y * by })

/** Point `i` of `path` moved `pad` to one side (`side` 1 or -1): the ends square, the corners mitred. */
function offsetAt(path: readonly Point[], dirs: readonly Point[], i: number, pad: number, side: number): Point {
  const p = path[i] as Point
  if (i === 0) return along(along(p, dirs[0] as Point, -pad), normal(dirs[0] as Point), pad * side)
  if (i === path.length - 1) return along(along(p, dirs[i - 1] as Point, pad), normal(dirs[i - 1] as Point), pad * side)
  const [a, b] = [normal(dirs[i - 1] as Point), normal(dirs[i] as Point)]
  const dot = a.x * b.x + a.y * b.y
  // The mitre of two sides; a wire that doubles back keeps the side it came in on.
  const mitre = 1 + dot < 0.1 ? a : { x: (a.x + b.x) / (1 + dot), y: (a.y + b.y) / (1 + dot) }
  return along(p, mitre, pad * side)
}

/** The closed outline `pad` round a polyline (in screen pixels): one side along it, the other back. */
export function wireOutline(points: readonly Point[], pad: number): Point[] {
  const path = points.filter((p, i) => i === 0 || p.x !== points[i - 1]?.x || p.y !== points[i - 1]?.y)
  if (path.length < 2) return []
  const dirs = path.slice(1).map((b, i) => unit(path[i] as Point, b))
  const side = (sign: number) => path.map((_, i) => offsetAt(path, dirs, i, pad, sign))
  return [...side(1), ...side(-1).reverse()]
}

/** The dashed hover outline round a wire whose points are in sheet units. */
export function drawWireHover(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, points: readonly Point[], look: WireLook): void {
  const outline = wireOutline(points.map((p) => worldToScreen(camera, size, p)), wireHoverPadPx(camera.scale))
  if (outline.length === 0) return
  ctx.save()
  ctx.strokeStyle = look.hover
  ctx.lineWidth = 1
  ctx.setLineDash(OUTLINE_DASH)
  ctx.beginPath()
  outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.closePath()
  ctx.stroke()
  ctx.restore()
}

/** A selected wire's handles: a filled square on each corner, then a hollow one on each end. */
export function drawWireHandles(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, points: readonly Point[], look: WireLook): void {
  const { corners, ends } = wireHandles(points)
  const half = WIRE_HANDLE_PX / 2
  const square = (p: Point, filled: boolean) => {
    const at = worldToScreen(camera, size, p)
    if (filled) ctx.fillRect(at.x - half, at.y - half, WIRE_HANDLE_PX, WIRE_HANDLE_PX)
    ctx.strokeRect(at.x - half, at.y - half, WIRE_HANDLE_PX, WIRE_HANDLE_PX)
  }
  ctx.save()
  ctx.fillStyle = look.handleFill
  ctx.strokeStyle = look.selected
  ctx.lineWidth = 1.5
  ctx.setLineDash([])
  for (const corner of corners) square(corner, true)
  for (const end of ends) square(end, false)
  ctx.restore()
}
