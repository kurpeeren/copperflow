// Paints the schematic's drawing border and title block (geometry in sheet.ts) in CSS pixels.
import { worldToScreen, type Box, type Camera, type Point, type Size } from "./geometry.js"
import { schematicTheme } from "./schematic-theme.js"
import { titleBlock, zoneDividers, zoneLabels, type Sheet, type TitleValues } from "./sheet.js"

/** Text heights in inches. */
export const ZONE_TEXT = 0.12
const LABEL_TEXT = 0.09
const VALUE_TEXT = 0.14
const CELL_PADDING = 0.06
/** Zone labels smaller than this on screen are left out; the border stays. */
export const MIN_ZONE_LABEL_PX = 6
const OUTER_LINE_PX = 2

export function showZoneLabels(scale: number): boolean {
  return ZONE_TEXT * scale >= MIN_ZONE_LABEL_PX
}

function strokeBox(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, box: Box): void {
  const a = worldToScreen(camera, size, { x: box.minX, y: box.minY })
  const b = worldToScreen(camera, size, { x: box.maxX, y: box.maxY })
  ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y)
}

function line(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, from: Point, to: Point): void {
  const a = worldToScreen(camera, size, from)
  const b = worldToScreen(camera, size, to)
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
}

function text(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, at: Point, value: string, height: number, align: CanvasTextAlign): void {
  if (!value) return
  const p = worldToScreen(camera, size, at)
  ctx.font = `${height * camera.scale}px sans-serif`
  ctx.textAlign = align
  ctx.fillText(value, p.x, p.y)
}

function drawZones(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, sheet: Sheet): void {
  const { xs, ys } = zoneDividers(sheet)
  ctx.beginPath()
  for (const x of xs) {
    line(ctx, camera, size, { x, y: sheet.outer.minY }, { x, y: sheet.inner.minY })
    line(ctx, camera, size, { x, y: sheet.inner.maxY }, { x, y: sheet.outer.maxY })
  }
  for (const y of ys) {
    line(ctx, camera, size, { x: sheet.outer.minX, y }, { x: sheet.inner.minX, y })
    line(ctx, camera, size, { x: sheet.inner.maxX, y }, { x: sheet.outer.maxX, y })
  }
  ctx.stroke()
  if (!showZoneLabels(camera.scale)) return
  ctx.fillStyle = schematicTheme.titleText
  ctx.textBaseline = "middle"
  for (const label of zoneLabels(sheet)) text(ctx, camera, size, label, label.text, ZONE_TEXT, "center")
}

function drawTitleBlock(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, sheet: Sheet, values: TitleValues): void {
  const block = titleBlock(sheet, values)
  ctx.lineWidth = 1
  strokeBox(ctx, camera, size, block.box)
  for (const cell of block.cells) strokeBox(ctx, camera, size, cell.box)
  ctx.fillStyle = schematicTheme.titleText
  ctx.textBaseline = "middle"
  for (const cell of block.cells) {
    const at = { x: cell.box.minX + CELL_PADDING, y: (cell.box.minY + cell.box.maxY) / 2 }
    text(ctx, camera, size, at, cell.text, cell.kind === "label" ? LABEL_TEXT : VALUE_TEXT, "left")
  }
}

/** The outer and inner lines, the zone ticks and labels and the title block; drawn over the grid and under the parts. */
export function drawSheetBorder(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, sheet: Sheet, values: TitleValues): void {
  ctx.save()
  ctx.strokeStyle = schematicTheme.border
  ctx.lineWidth = OUTER_LINE_PX
  strokeBox(ctx, camera, size, sheet.outer)
  ctx.lineWidth = 1
  strokeBox(ctx, camera, size, sheet.inner)
  drawZones(ctx, camera, size, sheet)
  drawTitleBlock(ctx, camera, size, sheet, values)
  ctx.restore()
}
