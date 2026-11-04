// Everything copperflow draws on top of the board, in CSS pixels.
import { gridSteps, screenToWorld, worldToScreen, type Box, type Camera, type Point, type Size } from "./geometry"

const COPPER = "#e0a46a"
const MASK = "#4f9a6c"
const TEXT = "#e9e6df"
const PANEL = "rgb(34 38 44 / 92%)"
const FONT = '12px "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'
const MAX_LABEL = 32

/** Dots on the minor grid, faint lines on the major grid, and the origin axes. */
export function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, size: Size): void {
  const { minor, major } = gridSteps(camera.scale)
  const topLeft = screenToWorld(camera, size, { x: 0, y: 0 })
  const bottomRight = screenToWorld(camera, size, { x: size.width, y: size.height })
  const columns = (step: number) => range(Math.floor(topLeft.x / step), Math.ceil(bottomRight.x / step)).map((i) => i * step)
  const rows = (step: number) => range(Math.floor(bottomRight.y / step), Math.ceil(topLeft.y / step)).map((i) => i * step)

  ctx.fillStyle = "rgb(233 230 223 / 13%)"
  if (minor * camera.scale >= 10) {
    for (const x of columns(minor)) {
      for (const y of rows(minor)) {
        const p = worldToScreen(camera, size, { x, y })
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1)
      }
    }
  }
  ctx.strokeStyle = "rgb(233 230 223 / 7%)"
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const x of columns(major)) {
    const sx = Math.round(worldToScreen(camera, size, { x, y: 0 }).x) + 0.5
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, size.height)
  }
  for (const y of rows(major)) {
    const sy = Math.round(worldToScreen(camera, size, { x: 0, y }).y) + 0.5
    ctx.moveTo(0, sy)
    ctx.lineTo(size.width, sy)
  }
  ctx.stroke()

  const origin = worldToScreen(camera, size, { x: 0, y: 0 })
  ctx.strokeStyle = "rgb(201 138 75 / 28%)"
  ctx.beginPath()
  ctx.moveTo(Math.round(origin.x) + 0.5, 0)
  ctx.lineTo(Math.round(origin.x) + 0.5, size.height)
  ctx.moveTo(0, Math.round(origin.y) + 0.5)
  ctx.lineTo(size.width, Math.round(origin.y) + 0.5)
  ctx.stroke()
}

/** A selection outline (copper) or hover outline (dashed) around a part, shifted by a drag. */
export function drawOutline(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  size: Size,
  box: Box,
  offset: Point,
  kind: "selected" | "hover",
): void {
  const a = worldToScreen(camera, size, { x: box.minX + offset.x, y: box.maxY + offset.y })
  const b = worldToScreen(camera, size, { x: box.maxX + offset.x, y: box.minY + offset.y })
  const pad = 3
  ctx.save()
  ctx.lineWidth = kind === "selected" ? 1.5 : 1
  ctx.strokeStyle = kind === "selected" ? COPPER : "rgb(233 230 223 / 45%)"
  ctx.setLineDash(kind === "selected" ? [] : [4, 3])
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
export function drawSelectionBox(ctx: CanvasRenderingContext2D, a: Point, b: Point): void {
  ctx.save()
  ctx.fillStyle = "rgb(201 138 75 / 10%)"
  ctx.strokeStyle = COPPER
  ctx.setLineDash([5, 4])
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

function range(from: number, to: number): number[] {
  const values: number[] = []
  for (let i = from; i <= to; i++) values.push(i)
  return values
}
