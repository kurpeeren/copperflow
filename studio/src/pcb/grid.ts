// The canvas grid: the steps to choose from (one step is both the grid and the snap), the lines-or-dots style each
// document keeps, and the painting both canvases share.
import { screenToWorld, worldToScreen, type Camera, type Size } from "./geometry.js"
import type { View } from "./positions.js"
import { snapLabel, type Unit } from "./units.js"

const MIL = 0.0254

/** The PCB's steps in mm, smallest first: EasyEDA's 2 to 100 mil steps, and 0.1, 0.5 and 1 mm. */
export const PCB_GRID_STEPS: readonly number[] = [2 * MIL, 0.1, 5 * MIL, 10 * MIL, 0.5, 20 * MIL, 25 * MIL, 1, 50 * MIL, 100 * MIL].map((mm) => Number(mm.toFixed(4)))
export const PCB_DEFAULT_STEP = 0.5

/** The sheet's steps in sheet units (inches). */
export const SHEET_GRID_STEPS: readonly number[] = [0.05, 0.1, 0.2]
export const SHEET_DEFAULT_STEP = 0.1

export const defaultStep = (view: View): number => (view === "pcb" ? PCB_DEFAULT_STEP : SHEET_DEFAULT_STEP)

/** Each document keeps its own Grid step. */
export type GridSteps = Readonly<Record<View, number>>

export const INITIAL_GRID_STEPS: GridSteps = { schematic: SHEET_DEFAULT_STEP, pcb: PCB_DEFAULT_STEP }

export const setGridStep = (steps: GridSteps, view: View, step: number): GridSteps => ({ ...steps, [view]: step })

export interface StepOption {
  value: number
  label: string
}

/** The Grid select's options: the PCB's follow the unit, the sheet's are always inches. */
export function gridStepOptions(view: View, unit: Unit): StepOption[] {
  if (view === "schematic") return SHEET_GRID_STEPS.map((value) => ({ value, label: `${value} in` }))
  return PCB_GRID_STEPS.map((value) => ({ value, label: snapLabel(value, unit) }))
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

const isFifth = (index: number) => index % GRID_EVERY === 0

function paintLines(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, plan: GridPlan, colours: GridColours): void {
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
  ctx.lineWidth = 1
  lines(plan.columns, (i) => {
    const sx = Math.round(worldToScreen(camera, size, { x: i * spacing, y: 0 }).x) + 0.5
    return [sx, 0, sx, size.height]
  })
  lines(plan.rows, (i) => {
    const sy = Math.round(worldToScreen(camera, size, { x: 0, y: i * spacing }).y) + 0.5
    return [0, sy, size.width, sy]
  })
}

function paintDots(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, plan: GridPlan, colours: GridColours): void {
  const { spacing } = plan
  const xs = plan.columns.map((i) => [i, Math.round(worldToScreen(camera, size, { x: i * spacing, y: 0 }).x)] as const)
  const ys = plan.rows.map((j) => [j, Math.round(worldToScreen(camera, size, { x: 0, y: j * spacing }).y)] as const)
  for (const [colour, wanted] of [[colours.minor, false], [colours.fifth ?? colours.minor, true]] as const) {
    ctx.fillStyle = colour
    ctx.beginPath()
    for (const [i, x] of xs) for (const [j, y] of ys) if (!colours.fifth || (isFifth(i) && isFifth(j)) === wanted) ctx.rect(x, y, 1, 1)
    ctx.fill()
    if (!colours.fifth) return
  }
}

/** Paints the grid at the look's step, as lines or as 1 px dots at their crossings, in CSS pixels. */
export function paintGrid(ctx: CanvasRenderingContext2D, camera: Camera, size: Size, look: GridLook, colours: GridColours): void {
  const plan = planGrid(camera, size, look.step)
  if (!plan) return
  ctx.save()
  if (look.style === "dots") paintDots(ctx, camera, size, plan, colours)
  else paintLines(ctx, camera, size, plan, colours)
  ctx.restore()
}
