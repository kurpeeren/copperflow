// The schematic's grid: thin solid lines in the palette's grid colour, as EasyEDA Pro draws it, or 2 x 2 px dots in the
// darker dot colour, since lone 1 px dots in the line colour do not show on the light sheet (ruling R20). The dark
// palette adds a brighter fifth line and dot; both fade with the zoom as grid.ts plans.
import type { Camera, Size } from "./geometry.js"
import { paintGrid, type GridLook, type GridPaint } from "./grid.js"
import { sheetPalette, type SchematicPalette } from "./schematic-theme.js"

export const SHEET_DOT_PX = 2
/** How a palette paints the grid: its line and dot colours, and the brighter fifth when it has one. */
export function sheetGridPaint(palette: SchematicPalette): GridPaint {
  const fifth = palette.gridFifth ? { fifth: palette.gridFifth } : {}
  return { lines: { minor: palette.grid, ...fifth }, dots: { minor: palette.gridDot, ...fifth, px: SHEET_DOT_PX } }
}

/** Paints the grid at the chosen step, in CSS pixels, in the palette's colours (the sheet's current one by default). */
export function drawSchematicGrid(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, look: GridLook, ratio: number, palette: SchematicPalette = sheetPalette()): void {
  paintGrid(ctx, camera, size, look, sheetGridPaint(palette), ratio)
}
