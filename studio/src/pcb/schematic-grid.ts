// The schematic's grid: thin solid lines in the theme's grid colour, as EasyEDA Pro draws it, or 2 x 2 px dots in the
// darker dot colour, since lone 1 px dots in the line colour do not show on the light sheet (ruling R20).
import type { Camera, Size } from "./geometry.js"
import { paintGrid, type GridLook, type GridPaint } from "./grid.js"
import { schematicTheme } from "./schematic-theme.js"

export const SHEET_DOT_PX = 2
const SHEET_GRID: GridPaint = { lines: { minor: schematicTheme.grid }, dots: { minor: schematicTheme.gridDot, px: SHEET_DOT_PX } }

/** Paints the grid at the chosen step, in CSS pixels; every line has the one colour and every dot the other. */
export function drawSchematicGrid(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, look: GridLook, ratio = 1): void {
  paintGrid(ctx, camera, size, look, SHEET_GRID, ratio)
}
