// The schematic's grid: thin solid lines in the theme's grid colour, as EasyEDA Pro draws it.
import { screenToWorld, worldToScreen, type Camera, type Size } from "./geometry.js"
import { schematicTheme } from "./schematic-theme.js"

/** The sheet grid in sheet units (inches). */
export const SHEET_GRID = 0.1
const MIN_LINE_GAP_PX = 8
const COARSE_FACTOR = 5

/** The distance between drawn lines: every grid step once it is at least 8 px on screen, else every fifth step. */
export function gridLineSpacing(step: number, scale: number): number {
  return step * scale >= MIN_LINE_GAP_PX ? step : step * COARSE_FACTOR
}

/** World positions of the vertical and horizontal lines that fall in the view. */
export function gridLinePositions(camera: Camera, size: Size, step: number): { xs: number[]; ys: number[] } {
  const spacing = gridLineSpacing(step, camera.scale)
  const topLeft = screenToWorld(camera, size, { x: 0, y: 0 })
  const bottomRight = screenToWorld(camera, size, { x: size.width, y: size.height })
  const between = (a: number, b: number) => {
    const values: number[] = []
    for (let i = Math.floor(Math.min(a, b) / spacing); i <= Math.ceil(Math.max(a, b) / spacing); i++) values.push(i * spacing)
    return values
  }
  return { xs: between(topLeft.x, bottomRight.x), ys: between(topLeft.y, bottomRight.y) }
}

/** Paints the grid lines in CSS pixels. */
export function drawSchematicGrid(ctx: CanvasRenderingContext2D, camera: Camera, size: Size): void {
  const { xs, ys } = gridLinePositions(camera, size, SHEET_GRID)
  ctx.save()
  ctx.strokeStyle = schematicTheme.grid
  ctx.lineWidth = 1
  ctx.beginPath()
  for (const x of xs) {
    const sx = Math.round(worldToScreen(camera, size, { x, y: 0 }).x) + 0.5
    ctx.moveTo(sx, 0)
    ctx.lineTo(sx, size.height)
  }
  for (const y of ys) {
    const sy = Math.round(worldToScreen(camera, size, { x: 0, y }).y) + 0.5
    ctx.moveTo(0, sy)
    ctx.lineTo(size.width, sy)
  }
  ctx.stroke()
  ctx.restore()
}
