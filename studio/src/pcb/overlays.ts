// Everything copperflow draws on top of the board, in CSS pixels. Each view passes its own look: PCB_LOOK takes its
// colours from PALETTE and SHEET_LOOK from schematicTheme, so nothing here falls back to the other view's colours.
import type { BoxMode } from "./box-select.js"
import { CANVAS_FONT_FAMILY, PALETTE } from "./ctx.js"
import { paintGrid, type GridLook, type GridPaint } from "./grid.js"
import { worldToScreen, type Box, type Camera, type Point, type Size } from "./geometry.js"
import { deviceWidth, hairlineWidth, squareAt, squareSide, strokeBoxAt } from "./crisp.js"
import { schematicTheme } from "./schematic-theme.js"
import { fontPxFor, sharpenText, textAnchorAt } from "./text-level.js"

/** A note's text size in CSS pixels; it is drawn at the nearest whole device pixel size. */
const NOTE_TEXT_PX = 12
const MAX_LABEL = 32

const PCB_GRID_COLOURS = { minor: PALETTE.grid, fifth: PALETTE.gridFifth }
const PCB_GRID: GridPaint = { lines: PCB_GRID_COLOURS, dots: { ...PCB_GRID_COLOURS, px: 1 } }

/** White grid lines or 1 px dots at the chosen step: 30% on the minor grid, 50% on every fifth line (or fifth crossing). */
export function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, look: GridLook, ratio: number): void {
  paintGrid(ctx, camera, size, look, PCB_GRID, ratio)
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
  /** Dash pattern of the note box. */
  noteDash: number[]
  /** The selection box: its outline, solid when dragged left to right and `boxDash` right to left, and its wash. */
  boxStroke: string
  boxFill: string
  boxDash: number[]
  /** The lock badge's ground and its padlock. */
  lockFill: string
  lockGlyph: string
  /** A note for the agent: its pin and leader, the panel behind its text, and the text. */
  markPin: string
  markPanel: string
  markText: string
}

/** The PCB's look: white selection with a 50% wash, white hover, the cyan selection box (dotted right to left) and note box, notes and locks in the white document colour. */
export const PCB_LOOK: OverlayLook = {
  selected: PALETTE.selection,
  selectedFill: PALETTE.selectionFill,
  hover: PALETTE.hover,
  noteStroke: PALETTE.selectionBox,
  noteFill: PALETTE.selectionBoxFill,
  noteDash: [1, 3],
  boxStroke: PALETTE.selectionBox,
  boxFill: PALETTE.selectionBoxFill,
  boxDash: [1, 3],
  lockFill: PALETTE.document,
  lockGlyph: PALETTE.background,
  markPin: PALETTE.document,
  markPanel: PALETTE.notePanel,
  markText: PALETTE.document,
}

/** The schematic's look: red selection and note box and a blue selection box on the light sheet, with our own hover, lock and note colours. */
export const SHEET_LOOK: OverlayLook = {
  selected: schematicTheme.selection,
  hover: schematicTheme.hover,
  noteStroke: schematicTheme.selection,
  noteFill: schematicTheme.selectionFill,
  noteDash: [5, 4],
  boxStroke: schematicTheme.selectionBox,
  boxFill: schematicTheme.selectionBoxFill,
  boxDash: [5, 4],
  lockFill: schematicTheme.lockBadge,
  lockGlyph: schematicTheme.lockGlyph,
  markPin: schematicTheme.notePin,
  markPanel: schematicTheme.notePanel,
  markText: schematicTheme.noteText,
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
  ratio: number,
): void {
  const a = worldToScreen(camera, size, { x: box.minX + offset.x, y: box.maxY + offset.y })
  const b = worldToScreen(camera, size, { x: box.maxX + offset.x, y: box.minY + offset.y })
  const pad = 3
  const devicePx = kind === "selected" ? deviceWidth(1.5, ratio) : 1
  const rect = strokeBoxAt({ x: a.x - pad, y: a.y - pad }, { x: b.x + pad, y: b.y + pad }, ratio, devicePx)
  ctx.save()
  ctx.lineWidth = devicePx / ratio
  ctx.strokeStyle = kind === "selected" ? look.selected : look.hover
  ctx.setLineDash(kind === "selected" ? [] : [4, 3])
  if (kind === "selected" && look.selectedFill) {
    ctx.fillStyle = look.selectedFill
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  }
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
  ctx.restore()
}

/** A small padlock at the part's top-right corner. */
export function drawLockBadge(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, box: Box, look: OverlayLook, ratio: number): void {
  const corner = worldToScreen(camera, size, { x: box.maxX, y: box.maxY })
  const x = squareAt(corner.x - 4, ratio)
  const y = squareAt(corner.y - 12, ratio)
  const side = squareSide(14, ratio)
  ctx.save()
  ctx.fillStyle = look.lockFill
  roundRect(ctx, x, y, side, side, 3)
  ctx.fill()
  ctx.strokeStyle = look.lockGlyph
  ctx.fillStyle = look.lockGlyph
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.arc(x + 7, y + 6, 2.4, Math.PI, 0)
  ctx.stroke()
  ctx.fillRect(x + 3.5, y + 6, 7, 5)
  ctx.restore()
}

/** A note for the agent: a pin with its id and text. */
export function drawMark(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, note: { at: Point; id: string; text: string }, look: OverlayLook, ratio: number): void {
  const { at, id, text } = note
  const p = worldToScreen(camera, size, at)
  const label = `${id}  ${text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text}`
  ctx.save()
  sharpenText(ctx)
  ctx.font = `${fontPxFor(NOTE_TEXT_PX, 1, ratio)}px ${CANVAS_FONT_FAMILY}`
  const width = ctx.measureText(label).width + 12
  ctx.fillStyle = look.markPanel
  roundRect(ctx, p.x + 10, p.y - 22, width, 20, 4)
  ctx.fill()
  ctx.fillStyle = look.markText
  const anchor = textAnchorAt({ x: p.x + 16, y: p.y - 8 }, ratio)
  ctx.fillText(label, anchor.x, anchor.y)
  ctx.strokeStyle = look.markPin
  ctx.lineWidth = deviceWidth(1.5, ratio) / ratio
  ctx.beginPath()
  ctx.moveTo(p.x, p.y)
  ctx.lineTo(p.x + 10, p.y - 12)
  ctx.stroke()
  ctx.fillStyle = look.markPin
  ctx.beginPath()
  ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/** The selection box: a solid outline dragged left to right (it takes what is inside), dashed right to left (what it touches). */
export function drawSelectionBox(ctx: CanvasRenderingContext2D, a: Point, b: Point, look: OverlayLook, mode: BoxMode, ratio: number): void {
  drawBox(ctx, a, b, { stroke: look.boxStroke, fill: look.boxFill, dash: mode === "inside" ? [] : look.boxDash }, ratio)
}

/** The box drawn with Place → Note box, where a note for the agent goes. */
export function drawNoteBox(ctx: CanvasRenderingContext2D, a: Point, b: Point, look: OverlayLook, ratio: number): void {
  drawBox(ctx, a, b, { stroke: look.noteStroke, fill: look.noteFill, dash: look.noteDash }, ratio)
}

function drawBox(ctx: CanvasRenderingContext2D, a: Point, b: Point, style: { stroke: string; fill: string; dash: number[] }, ratio: number): void {
  const rect = strokeBoxAt(a, b, ratio)
  ctx.save()
  ctx.lineWidth = hairlineWidth(ratio)
  ctx.fillStyle = style.fill
  ctx.strokeStyle = style.stroke
  ctx.setLineDash(style.dash)
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
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
 * `points` in world units, in the view's wire colour.
 */
export function drawWirePreview(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, points: Point[], kind: "drawing" | "pending", color: string, ratio: number): void {
  const screen = points.map((p) => worldToScreen(camera, size, p))
  const last = screen[screen.length - 1]
  if (!last) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = deviceWidth(2, ratio) / ratio
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

/** Outlines the parts' names and values (or designators) that are selected, and the one under the pointer when it is not. */
export function drawTextOutlines(
  ctx: CanvasRenderingContext2D,
  view: { camera: Camera; size: Size },
  texts: readonly { id: string; box: Box }[],
  marked: { selected: readonly string[]; hover: string | undefined },
  look: OverlayLook,
  ratio: number,
): void {
  for (const text of texts) {
    const kind = marked.selected.includes(text.id) ? "selected" : text.id === marked.hover ? "hover" : undefined
    if (kind) drawOutline(ctx, view.camera, view.size, text.box, { x: 0, y: 0 }, kind, look, ratio)
  }
}
