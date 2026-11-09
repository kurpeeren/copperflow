// The schematic's grid: thin solid lines or 1 px dots in the theme's grid colour, as EasyEDA Pro draws it.
import type { Camera, Size } from "./geometry.js"
import { paintGrid, type GridLook } from "./grid.js"
import { schematicTheme } from "./schematic-theme.js"

/** Paints the grid at the chosen step, in CSS pixels; every line and dot has the one colour. */
export function drawSchematicGrid(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, look: GridLook): void {
  paintGrid(ctx, camera, size, look, { minor: schematicTheme.grid })
}
