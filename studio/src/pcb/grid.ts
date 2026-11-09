// The canvas grid: the steps to choose from (one step is both the grid and the snap), the lines-or-dots style each
// document keeps, and the painting both canvases share.
import { screenToWorld, worldToScreen, type Camera, type Size } from "./geometry.js"
import type { View } from "./positions.js"
import { hairlineAt, hairlineWidth, squareAt, squareSide } from "./crisp.js"
import { gridStepLabel, type Unit } from "./units.js"

const MIL = 0.0254

/** The PCB's steps in mm, smallest first: EasyEDA's 2 to 100 mil steps, and 0.1, 0.5 and 1 mm. */
export const PCB_GRID_STEPS: readonly number[] = [2 * MIL, 0.1, 5 * MIL, 10 * MIL, 0.5, 20 * MIL, 25 * MIL, 1, 50 * MIL, 100 * MIL].map((mm) => Number(mm.toFixed(4)))
export const PCB_DEFAULT_STEP = 0.5

/** The sheet's steps in sheet units (inches). */
export const SHEET_GRID_STEPS: readonly number[] = [0.05, 0.1, 0.2]
export const SHEET_DEFAULT_STEP = 0.1

/** Each document keeps its own Grid step. */
export type GridSteps = Readonly<Record<View, number>>

export const INITIAL_GRID_STEPS: GridSteps = { schematic: SHEET_DEFAULT_STEP, pcb: PCB_DEFAULT_STEP }

export const setGridStep = (steps: GridSteps, view: View, step: number): GridSteps => ({ ...steps, [view]: step })

export interface StepOption {
  value: number
  label: string
}

/** The Grid select's options: the PCB's follow its display unit; the sheet has no unit to choose and is always in inches. */
export function gridStepOptions(view: "schematic"): StepOption[]
export function gridStepOptions(view: "pcb", unit: Unit): StepOption[]
export function gridStepOptions(view: View, unit?: Unit): StepOption[] {
  if (view === "schematic") return SHEET_GRID_STEPS.map((value) => ({ value, label: `${value} in` }))
  if (!unit) throw new Error("The PCB's Grid steps need its display unit")
  return PCB_GRID_STEPS.map((value) => ({ value, label: gridStepLabel(value, unit) }))
}

export type GridStyle = "lines" | "dots"
/** Each document keeps its own style. */
export type GridStyles = Readonly<Record<View, GridStyle>>

export const INITIAL_GRID_STYLES: GridStyles = { schematic: "lines", pcb: "lines" }

export const nextGridStyle = (style: GridStyle): GridStyle => (style === "lines" ? "dots" : "lines")

export const toggleGridStyle = (styles: GridStyles, view: View): GridStyles => ({ ...styles, [view]: nextGridStyle(styles[view]) })

const MIN_LINE_GAP_PX = 8
const COARSE_FACTOR = 5
const MAX_COARSENING = 2
/** Every fifth line (or, for dots, every fifth crossing in both directions) is drawn stronger. */
export const GRID_EVERY = 5

/** The distance between drawn lines: the step, stepped up by 5 until it is at least 8 px on screen; null when even 25 steps are closer than that. */
export function gridLineSpacing(step: number, scale: number): number | null {
  let spacing = step
  for (let i = 0; i <= MAX_COARSENING; i++, spacing *= COARSE_FACTOR) if (spacing * scale >= MIN_LINE_GAP_PX) return spacing
  return null
}

/** The grid in the view: its spacing and the indices (world position / spacing) of the columns and rows that fall in it. */
export interface GridPlan {
  spacing: number
  columns: number[]
  rows: number[]
}

export function planGrid(camera: Camera, size: Size, step: number): GridPlan | null {
  const spacing = gridLineSpacing(step, camera.scale)
  if (spacing === null) return null
  const a = screenToWorld(camera, size, { x: 0, y: 0 })
  const b = screenToWorld(camera, size, { x: size.width, y: size.height })
  const between = (p: number, q: number) => {
    const indices: number[] = []
    for (let i = Math.floor(Math.min(p, q) / spacing); i <= Math.ceil(Math.max(p, q) / spacing); i++) indices.push(i)
    return indices
  }
  return { spacing, columns: between(a.x, b.x), rows: between(a.y, b.y) }
}

export interface GridLook {
  step: number
  style: GridStyle
}

export interface GridColours {
  minor: string
  /** For every fifth line or crossing; omitted when the grid has no stronger one. */
  fifth?: string
}

/** How a view paints its grid: the line colours, and the dot colours with the side of a dot in CSS pixels. */
export interface GridPaint {
  lines: GridColours
  dots: GridColours & { px: number }
}

const isFifth = (index: number) => index % GRID_EVERY === 0

function paintLines(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, plan: GridPlan, colours: GridColours, ratio: number): void {
  const { spacing } = plan
  const lines = (indices: number[], at: (i: number) => [number, number, number, number]) => {
    for (const [colour, wanted] of [[colours.minor, false], [colours.fifth ?? colours.minor, true]] as const) {
      ctx.strokeStyle = colour
      ctx.beginPath()
      for (const i of indices.filter((n) => !colours.fifth || isFifth(n) === wanted)) {
        const [x1, y1, x2, y2] = at(i)
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
      }
      ctx.stroke()
      if (!colours.fifth) return
    }
  }
  ctx.lineWidth = hairlineWidth(ratio)
  lines(plan.columns, (i) => {
    const sx = hairlineAt(worldToScreen(camera, size, { x: i * spacing, y: 0 }).x, ratio)
    return [sx, 0, sx, size.height]
  })
  lines(plan.rows, (i) => {
    const sy = hairlineAt(worldToScreen(camera, size, { x: 0, y: i * spacing }).y, ratio)
    return [0, sy, size.width, sy]
  })
}

/** The screen positions of the dots' top-left corners along one axis (on device pixel edges), and which of them fall on a fifth line. */
function dotAxis(indices: number[], at: (i: number) => number, side: number, ratio: number) {
  const offset = Math.floor((Math.round(side * ratio) - 1) / 2) / ratio
  return indices.map((i) => ({ at: squareAt(at(i), ratio) - offset, fifth: isFifth(i) }))
}

function fillSquares(ctx: CanvasRenderingContext2D, corners: readonly number[], colour: string, px: number): void {
  ctx.fillStyle = colour
  ctx.beginPath()
  for (let k = 0; k + 1 < corners.length; k += 2) ctx.rect(corners[k] as number, corners[k + 1] as number, px, px)
  ctx.fill()
}

/**
 * One square per crossing, in one walk over the crossings: the minor ones go straight into one path and the fifth
 * crossings (1 in 25) are kept for a second path, so the grid costs one rect per dot and one fill per colour.
 */
function paintDots(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, plan: GridPlan, dots: GridPaint["dots"], ratio: number): void {
  const { spacing } = plan
  const side = squareSide(dots.px, ratio)
  const columns = dotAxis(plan.columns, (i) => worldToScreen(camera, size, { x: i * spacing, y: 0 }).x, side, ratio)
  const rows = dotAxis(plan.rows, (j) => worldToScreen(camera, size, { x: 0, y: j * spacing }).y, side, ratio)
  const strong: number[] = []
  ctx.fillStyle = dots.minor
  ctx.beginPath()
  for (const column of columns) {
    for (const row of rows) {
      if (dots.fifth && column.fifth && row.fifth) strong.push(column.at, row.at)
      else ctx.rect(column.at, row.at, side, side)
    }
  }
  ctx.fill()
  if (dots.fifth) fillSquares(ctx, strong, dots.fifth, side)
}

/** Paints the grid at the look's step, as hairlines or as square dots at their crossings, in CSS pixels, sharp at the device pixel `ratio`. */
export function paintGrid(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, look: GridLook, paint: GridPaint, ratio = 1): void {
  const plan = planGrid(camera, size, look.step)
  if (!plan) return
  ctx.save()
  if (look.style === "dots") paintDots(ctx, camera, size, plan, paint.dots, ratio)
  else paintLines(ctx, camera, size, plan, paint.lines, ratio)
  ctx.restore()
}
