// Draws the schematic's drawings: lines, rectangles, circles, arcs and buses on the sheet, in the drawing's colour (the
// theme's when it gives none), its width (never under one device pixel), its dashes and its 20% fill; texts upright in
// the canvas font, in screen space with the other text. Selected drawings take the selection colour, and a drawing a
// move takes is drawn where the move puts it. schematic-draw.ts calls both passes.
import type { SchematicDrawing } from "../../../src/engine/model.js"
import { anchorAlignment, CANVAS_FONT_FAMILY, HIGHLIGHT_DIM, type Ctx } from "./ctx.js"
import { colorOf, dashOf, drawnWidth, fillOf, isFilled, lineStyleOf, strokeWidthOf } from "./drawing-style.js"
import { devicePxFor, sheetLevelPx, textAnchorAt, textShown } from "./text-level.js"
import { worldToScreen, type Camera, type Size } from "./geometry.js"
import { schematicTheme } from "./schematic-theme.js"

/** How the drawings are painted this frame. */
export interface DrawingPaint {
  /** The selected drawings' ids: drawn in the selection colour. */
  selected?: readonly string[]
  /** A net is highlighted: the drawings, which are on no net, are dimmed. */
  dim?: boolean
}


const rad = (degrees: number): number => (degrees * Math.PI) / 180

/** The sheet's drawings with those in `moving` (the same ids, moved) in their place; the sheet's own list when none moves. */
export function shownDrawings(drawings: readonly SchematicDrawing[], moving: readonly SchematicDrawing[] | undefined): readonly SchematicDrawing[] {
  if (!moving || moving.length === 0) return drawings
  const moved = new Map(moving.map((drawing) => [drawing.id, drawing]))
  return drawings.map((drawing) => moved.get(drawing.id) ?? drawing)
}

/** How far an arc turns, in degrees: a whole turn or more is 360, anything else modulo 360. */
function sweepOf(startAngle: number, endAngle: number): number {
  const turn = endAngle - startAngle
  return Math.abs(turn) >= 360 ? 360 : ((turn % 360) + 360) % 360
}

/** Lays down the drawing's outline as the current path (the sheet's y is up, so an arc turns counter-clockwise). */
function outline(ctx: Ctx, drawing: Exclude<SchematicDrawing, { kind: "text" }>): void {
  ctx.beginPath()
  if (drawing.kind === "path" || drawing.kind === "bus") {
    drawing.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
    return
  }
  if (drawing.kind === "rect") {
    const { x, y, width, height } = drawing
    ctx.moveTo(x, y)
    ctx.lineTo(x + width, y)
    ctx.lineTo(x + width, y + height)
    ctx.lineTo(x, y + height)
    ctx.closePath()
    return
  }
  if (drawing.kind === "circle") return ctx.arc(drawing.x, drawing.y, drawing.radius, 0, 2 * Math.PI)
  const start = rad(drawing.startAngle)
  ctx.arc(drawing.x, drawing.y, drawing.radius, start, start + rad(sweepOf(drawing.startAngle, drawing.endAngle)))
}

/** The colour a drawing is drawn in this frame, and its alpha. */
function toneOf(drawing: SchematicDrawing, paint: DrawingPaint): { color: string; alpha: number } {
  if (paint.selected?.includes(drawing.id)) return { color: schematicTheme.selection, alpha: 1 }
  return { color: colorOf(drawing), alpha: paint.dim ? HIGHLIGHT_DIM : 1 }
}

/** Strokes (and fills) every drawing but the texts, in sheet units; `devicePx` is one device pixel in sheet units. */
export function drawDrawings(ctx: Ctx, drawings: readonly SchematicDrawing[], devicePx: number, paint: DrawingPaint): void {
  for (const drawing of drawings) {
    if (drawing.kind === "text") continue
    const { color, alpha } = toneOf(drawing, paint)
    const width = drawnWidth(strokeWidthOf(drawing), devicePx)
    ctx.globalAlpha = alpha
    ctx.lineWidth = width
    ctx.strokeStyle = color
    ctx.setLineDash(dashOf(lineStyleOf(drawing), width))
    outline(ctx, drawing)
    if (isFilled(drawing)) {
      ctx.fillStyle = fillOf(color)
      ctx.fill()
    }
    ctx.stroke()
    ctx.setLineDash([])
  }
  ctx.globalAlpha = 1
}

/**
 * Writes the drawings' texts upright at their anchors, in CSS pixels (the context's transform is the device `ratio`),
 * at whole device pixel sizes on device pixels; like values, they wait for the sheet's "all" level and 5 device pixels of their own.
 */
export function drawDrawingTexts(ctx: Ctx, drawings: readonly SchematicDrawing[], camera: Camera, size: Size, paint: DrawingPaint, ratio: number): void {
  for (const drawing of drawings) {
    if (drawing.kind !== "text" || drawing.text === "") continue
    const devicePx = devicePxFor(drawing.fontSize, camera.scale, ratio)
    if (!textShown("detail", sheetLevelPx(camera.scale, ratio), devicePx)) continue
    const fontPx = devicePx / ratio
    const { color, alpha } = toneOf(drawing, paint)
    const at = textAnchorAt(worldToScreen(camera, size, drawing), ratio)
    const [, horizontal] = anchorAlignment(drawing.anchor)
    ctx.globalAlpha = alpha
    ctx.fillStyle = color
    ctx.font = `${fontPx}px ${CANVAS_FONT_FAMILY}`
    ctx.textAlign = horizontal
    ctx.textBaseline = "middle"
    ctx.fillText(drawing.text, at.x, at.y)
  }
  ctx.globalAlpha = 1
}
