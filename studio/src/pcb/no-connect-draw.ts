// Draws the schematic's no connect flags: a cross at the end of each flagged pin, in the theme's no-connect colour, as
// EasyEDA draws its flag. Under the sheet's transform, in sheet units. Pure apart from the context.
import type { NoConnectFlag } from "../../../src/engine/no-connect.js"
import { HIGHLIGHT_DIM, type Ctx } from "./ctx.js"
import { sheetPalette } from "./schematic-theme.js"

/** Half the cross's size, in sheet units. */
export const NO_CONNECT_HALF = 0.05
const NO_CONNECT_WIDTH = 0.015

/** The two strokes of the cross at `at`, as pairs of points. */
export function noConnectStrokes(at: { x: number; y: number }): [{ x: number; y: number }, { x: number; y: number }][] {
  const h = NO_CONNECT_HALF
  return [
    [{ x: at.x - h, y: at.y - h }, { x: at.x + h, y: at.y + h }],
    [{ x: at.x - h, y: at.y + h }, { x: at.x + h, y: at.y - h }],
  ]
}

/** Strokes every flag; `line` keeps a width at least one device pixel, as the sheet's other lines. */
export function drawNoConnects(ctx: Ctx, flags: readonly NoConnectFlag[], line: (width: number) => number, dim: boolean): void {
  if (flags.length === 0) return
  ctx.strokeStyle = sheetPalette().noConnect
  ctx.lineWidth = line(NO_CONNECT_WIDTH)
  ctx.globalAlpha = dim ? HIGHLIGHT_DIM : 1
  for (const flag of flags) {
    for (const [a, b] of noConnectStrokes(flag.at)) {
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
}
