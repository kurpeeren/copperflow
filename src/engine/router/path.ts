import type { CopperLayer } from "../../core/layout-file.js"
import type { Point } from "../model.js"
import type { CellRef } from "./astar.js"
import { cellCentre, type NetRule, type RouterGrid } from "./grid.js"

/** A routed track in mm: its points are cell centres, so they lie on the grid. */
export interface RoutedTrack {
  layer: CopperLayer
  width: number
  points: Point[]
}

/** A routed via in mm, through every layer. */
export interface RoutedVia {
  at: Point
  drill: number
  diameter: number
  layers: CopperLayer[]
}

/** The copper one routed connection lays: net id, tracks (one per run on a layer) and vias (one per layer change). */
export interface RoutedCopper {
  net: string
  tracks: RoutedTrack[]
  vias: RoutedVia[]
}

/** A via joins top to bottom, and so every layer between. */
const THROUGH: CopperLayer[] = ["top", "bottom"]

/** The run's corners: its first and last cell and every cell where the direction changes. */
function corners(grid: RouterGrid, run: readonly CellRef[]): Point[] {
  const kept = run.filter((step, i) => {
    const [before, after] = [run[i - 1], run[i + 1]]
    if (before === undefined || after === undefined) return true
    return after.cell - step.cell !== step.cell - before.cell
  })
  return kept.map((step) => cellCentre(grid, step.cell))
}

/** Splits the steps where the layer changes. */
function runs(steps: readonly CellRef[]): CellRef[][] {
  const found: CellRef[][] = []
  for (const step of steps) {
    const run = found.at(-1)
    if (run !== undefined && run[0]?.layer === step.layer) run.push(step)
    else found.push([step])
  }
  return found
}

/**
 * The copper for a path of cells: a track for each run on one layer (a run of one cell, between two vias or at an
 * end, lays none), with points only at the corners, and a via of the net's size wherever the layer changes.
 */
export function pathCopper(grid: RouterGrid, steps: readonly CellRef[], rule: NetRule): RoutedCopper {
  const pieces = runs(steps)
  const tracks = pieces
    .filter((run) => run.length > 1)
    .map((run) => ({ layer: grid.layers[run[0]?.layer ?? 0] as CopperLayer, width: rule.width, points: corners(grid, run) }))
  const vias = pieces.slice(1).map((run) => ({ at: cellCentre(grid, run[0]?.cell ?? 0), drill: rule.via.drill, diameter: rule.via.diameter, layers: [...THROUGH] }))
  return { net: rule.net, tracks, vias }
}
