// The schematic's grid: thin solid lines or 1 px dots in the theme's grid colour, as EasyEDA Pro draws it.
import type { Camera, Size } from "./geometry.js"
import { SHEET_DEFAULT_STEP, gridLineSpacing, paintGrid, planGrid, type GridLook } from "./grid.js"
import { schematicTheme } from "./schematic-theme.js"

export { gridLineSpacing }

/** The default sheet grid in sheet units (inches). */
export const SHEET_GRID = SHEET_DEFAULT_STEP
const DEFAULT_LOOK: GridLook = { step: SHEET_GRID, style: "lines" }

/** World positions of the vertical and horizontal lines that fall in the view. */
export function gridLinePositions(camera: Camera, size: Size, step: number): { xs: number[]; ys: number[] } {
  const plan = planGrid(camera, size, step)
  if (!plan) return { xs: [], ys: [] }
  return { xs: plan.columns.map((i) => i * plan.spacing), ys: plan.rows.map((j) => j * plan.spacing) }
}

/** Paints the grid at the chosen step, in CSS pixels; every line and dot has the one colour. */
export function drawSchematicGrid(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, look: GridLook = DEFAULT_LOOK): void {
  paintGrid(ctx, camera, size, look, { minor: schematicTheme.grid })
}
