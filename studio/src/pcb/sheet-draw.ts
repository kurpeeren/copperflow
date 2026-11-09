// Paints the schematic's drawing border and title block (geometry in sheet.ts) in CSS pixels.
import { canvasFont, TEXT_WEIGHT } from "./ctx.js"
import { deviceWidth, hairlineAt, hairlineWidth, strokeBoxAt } from "./crisp.js"
import { worldToScreen, type Box, type Camera, type Point, type Size } from "./geometry.js"
import { schematicTheme } from "./schematic-theme.js"
import type { SheetArt } from "./sheet.js"
import { fitText } from "./pin-name-fit.js"
import { devicePxFor, sharpenText, sheetLevelPx, textAnchorAt, textShown } from "./text-level.js"

/** Text heights in inches. */
export const ZONE_TEXT = 0.12
const LABEL_TEXT = 0.09
const VALUE_TEXT = 0.14
const CELL_PADDING = 0.06
const OUTER_LINE_PX = 2
/** The title block's text heights by cell kind, so each size sets the font once. */
const CELL_TEXT = [
  ["label", LABEL_TEXT],
  ["value", VALUE_TEXT],
] as const

/** Zone labels, like all the sheet's text, wait for the sheet's "all" level and 5 device pixels of their own (text-level.ts); the border stays. */
export function showZoneLabels(scale: number, ratio: number): boolean {
  return textShown("detail", sheetLevelPx(scale, ratio), devicePxFor(ZONE_TEXT, scale, ratio))
}

/** The outline of a box in `devicePx`-wide device pixels, its edges on device pixels. */
function strokeBox(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, box: Box, ratio: number, devicePx = 1): void {
  const a = worldToScreen(camera, size, { x: box.minX, y: box.minY })
  const b = worldToScreen(camera, size, { x: box.maxX, y: box.maxY })
  ctx.lineWidth = devicePx / ratio
  const rect = strokeBoxAt(a, b, ratio, devicePx)
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height)
}

/** A one-device-pixel line; the horizontal or vertical one a zone tick is lies on a device pixel centre. */
function line(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, from: Point, to: Point, ratio: number): void {
  const a = worldToScreen(camera, size, from)
  const b = worldToScreen(camera, size, to)
  const vertical = a.x === b.x
  const snap = (p: Point) => (vertical ? { x: hairlineAt(p.x, ratio), y: p.y } : { x: p.x, y: hairlineAt(p.y, ratio) })
  const [start, end] = [snap(a), snap(b)]
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
}

/**
 * Sets the font for text `height` inches tall, in whole device pixels, once for all the text of that size; false when
 * the sheet's level or its own size leaves it out.
 */
function setTextHeight(ctx: CanvasRenderingContext2D, camera: Camera, height: number, ratio: number): boolean {
  const devicePx = devicePxFor(height, camera.scale, ratio)
  if (!textShown("detail", sheetLevelPx(camera.scale, ratio), devicePx)) return false
  ctx.font = canvasFont(TEXT_WEIGHT.regular, devicePx / ratio)
  return true
}

/** One string at `at` in the current font; when `width` inches are given, shortened with an ellipsis to fit them (or left out). */
function text(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, at: Point, value: string, ratio: number, width?: number): void {
  if (!value) return
  const shown = width === undefined ? value : fitText(value, width * camera.scale, (t) => ctx.measureText(t).width)
  if (shown === null) return
  const p = textAnchorAt(worldToScreen(camera, size, at), ratio)
  ctx.fillText(shown, p.x, p.y)
}

function drawZones(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, art: SheetArt, ratio: number): void {
  const { sheet, dividers: { xs, ys } } = art
  ctx.lineWidth = hairlineWidth(ratio)
  ctx.beginPath()
  for (const x of xs) {
    line(ctx, camera, size, { x, y: sheet.outer.minY }, { x, y: sheet.inner.minY }, ratio)
    line(ctx, camera, size, { x, y: sheet.inner.maxY }, { x, y: sheet.outer.maxY }, ratio)
  }
  for (const y of ys) {
    line(ctx, camera, size, { x: sheet.outer.minX, y }, { x: sheet.inner.minX, y }, ratio)
    line(ctx, camera, size, { x: sheet.inner.maxX, y }, { x: sheet.outer.maxX, y }, ratio)
  }
  ctx.stroke()
  if (!showZoneLabels(camera.scale, ratio) || !setTextHeight(ctx, camera, ZONE_TEXT, ratio)) return
  ctx.fillStyle = schematicTheme.titleText
  ctx.textBaseline = "middle"
  ctx.textAlign = "center"
  for (const label of art.labels) text(ctx, camera, size, label, label.text, ratio)
}

function drawTitleBlock(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, art: SheetArt, ratio: number): void {
  const block = art.block
  strokeBox(ctx, camera, size, block.box, ratio)
  for (const cell of block.cells) strokeBox(ctx, camera, size, cell.box, ratio)
  ctx.fillStyle = schematicTheme.titleText
  ctx.textBaseline = "middle"
  ctx.textAlign = "left"
  for (const [kind, height] of CELL_TEXT) {
    if (!setTextHeight(ctx, camera, height, ratio)) continue
    for (const cell of block.cells) {
      if (cell.kind !== kind) continue
      const at = { x: cell.box.minX + CELL_PADDING, y: (cell.box.minY + cell.box.maxY) / 2 }
      text(ctx, camera, size, at, cell.text, ratio, cell.box.maxX - cell.box.minX - 2 * CELL_PADDING)
    }
  }
}

/** The outer and inner lines, the zone ticks and labels and the title block; drawn over the grid and under the parts. */
export function drawSheetBorder(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, art: SheetArt, ratio: number): void {
  const { sheet } = art
  ctx.save()
  sharpenText(ctx)
  ctx.strokeStyle = schematicTheme.border
  strokeBox(ctx, camera, size, sheet.outer, ratio, deviceWidth(OUTER_LINE_PX, ratio))
  strokeBox(ctx, camera, size, sheet.inner, ratio)
  drawZones(ctx, camera, size, art, ratio)
  drawTitleBlock(ctx, camera, size, art, ratio)
  ctx.restore()
}
