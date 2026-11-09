// Everything copperflow draws on top of the board, in CSS pixels.
import { PCB_DEFAULT_STEP, paintGrid, type GridLook } from "./grid.js"
import { worldToScreen, type Box, type Camera, type Point, type Size } from "./geometry.js"

const COPPER = "#e0a46a"
const MASK = "#4f9a6c"
const TEXT = "#e9e6df"
const PANEL = "rgb(34 38 44 / 92%)"
const FONT = '12px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
const MAX_LABEL = 32

const GRID_MINOR = "rgb(255 255 255 / 30%)"
const GRID_FIFTH = "rgb(255 255 255 / 50%)"
const DEFAULT_GRID: GridLook = { step: PCB_DEFAULT_STEP, style: "lines" }

/** White grid lines or dots at the chosen step: 30% on the minor grid, 50% on every fifth line (or fifth crossing). */
export function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, look: GridLook = DEFAULT_GRID): void {
  paintGrid(ctx, camera, size, look, { minor: GRID_MINOR, fifth: GRID_FIFTH })
}

/** The colours of the overlays that differ between the canvases. */
export interface OverlayLook {
  selected: string
  hover: string
  /** Stroke and fill of the note box. */
  noteStroke: string
  noteFill: string
  /** Wash inside the selection outline, when there is one. */
  selectedFill?: string
  /** Dash pattern of the note box; defaults to dashes. */
  noteDash?: number[]
}

/** The PCB's look: white selection with a 50% wash, white hover, cyan dotted selection box. */
export const PCB_LOOK: OverlayLook = {
  selected: "#ffffff",
  selectedFill: "rgb(255 255 255 / 50%)",
  hover: "rgb(255 255 255 / 60%)",
  noteStroke: "#00ffff",
  noteFill: "rgb(0 255 255 / 10%)",
  noteDash: [1, 3],
}

/** A selection outline or hover outline (dashed) around a part, shifted by a drag. */
export function drawOutline(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  size: Size,
  box: Box,
  offset: Point,
  kind: "selected" | "hover",
  look: OverlayLook,
): void {
  const a = worldToScreen(camera, size, { x: box.minX + offset.x, y: box.maxY + offset.y })
  const b = worldToScreen(camera, size, { x: box.maxX + offset.x, y: box.minY + offset.y })
  const pad = 3
  ctx.save()
  ctx.lineWidth = kind === "selected" ? 1.5 : 1
  ctx.strokeStyle = kind === "selected" ? look.selected : look.hover
  ctx.setLineDash(kind === "selected" ? [] : [4, 3])
  if (kind === "selected" && look.selectedFill) {
    ctx.fillStyle = look.selectedFill
    ctx.fillRect(a.x - pad, a.y - pad, b.x - a.x + pad * 2, b.y - a.y + pad * 2)
  }
  ctx.strokeRect(a.x - pad, a.y - pad, b.x - a.x + pad * 2, b.y - a.y + pad * 2)
  ctx.restore()
}

/** A small padlock at the part's top-right corner. */
export function drawLockBadge(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, box: Box): void {
  const corner = worldToScreen(camera, size, { x: box.maxX, y: box.maxY })
  const x = corner.x - 4
  const y = corner.y - 12
  ctx.save()
  ctx.fillStyle = MASK
  roundRect(ctx, x, y, 14, 14, 3)
  ctx.fill()
  ctx.strokeStyle = "#ffffff"
  ctx.fillStyle = "#ffffff"
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.arc(x + 7, y + 6, 2.4, Math.PI, 0)
  ctx.stroke()
  ctx.fillRect(x + 3.5, y + 6, 7, 5)
  ctx.restore()
}

/** A note for the agent: a copper pin with its id and text. */
export function drawMark(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, at: Point, id: string, text: string): void {
  const p = worldToScreen(camera, size, at)
  const label = `${id}  ${text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text}`
  ctx.save()
  ctx.font = FONT
  const width = ctx.measureText(label).width + 12
  ctx.fillStyle = PANEL
  roundRect(ctx, p.x + 10, p.y - 22, width, 20, 4)
  ctx.fill()
  ctx.fillStyle = TEXT
  ctx.fillText(label, p.x + 16, p.y - 8)
  ctx.strokeStyle = COPPER
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  ctx.lineTo(p.x + 10, p.y - 12)
  ctx.stroke()
  ctx.fillStyle = COPPER
  ctx.beginPath()
  ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** The box drawn with Shift-drag to place a note. */
export function drawSelectionBox(ctx: CanvasRenderingContext2D, a: Point, b: Point, look: OverlayLook): void {
  ctx.save()
  ctx.fillStyle = look.noteFill
  ctx.strokeStyle = look.noteStroke
  ctx.setLineDash(look.noteDash ?? [5, 4])
  ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  ctx.strokeRect(Math.min(a.x, b.x) + 0.5, Math.min(a.y, b.y) + 0.5, Math.abs(b.x - a.x), Math.abs(b.y - a.y))
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/**
 * A wire being drawn (solid, ending in a ring) or one waiting for the build (dashed), along
 * `points` in world units.
 */
export function drawWirePreview(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, points: Point[], kind: "drawing" | "pending", color: string = COPPER): void {
  const screen = points.map((p) => worldToScreen(camera, size, p))
  const last = screen[screen.length - 1]
  if (!last) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = 2
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.globalAlpha = kind === "pending" ? 0.75 : 1
  ctx.setLineDash(kind === "pending" ? [6, 5] : [])
  ctx.beginPath()
  screen.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.stroke()
  if (kind === "drawing") {
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.arc(last.x, last.y, 5, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}
