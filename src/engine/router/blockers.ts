import { naturalCompare } from "../order.js"
import type { CellRef } from "./astar.js"
import { BOARD_EDGE, FREE, type RouterGrid } from "./grid.js"

/**
 * What keeps a connection's two ends apart. From each end the free cells it reaches are flooded (8 neighbours on a
 * layer, vias where a via may sit); the objects that border both floods separate them. When no single object borders
 * both (two objects meet to close the way), every object bordering either is named. The board edge is named only when
 * nothing else is.
 */

const DCOL = [1, 1, 0, -1, -1, -1, 0, 1] as const
const DROW = [0, 1, 1, 1, 0, -1, -1, -1] as const

/** The nodes (layer · cells + cell) reached from the starts through free cells. */
function flood(grid: RouterGrid, starts: readonly CellRef[]): Uint8Array {
  const cells = grid.cols * grid.rows
  const reached = new Uint8Array(grid.layers.length * cells)
  const queue: number[] = []
  const visit = (layer: number, cell: number) => {
    const node = layer * cells + cell
    if (reached[node] === 1 || grid.track[layer]?.[cell] !== FREE) return
    reached[node] = 1
    queue.push(node)
  }
  for (const { layer, cell } of starts) visit(layer, cell)
  for (let next = 0; next < queue.length; next++) {
    const node = queue[next] as number
    const [layer, cell] = [Math.floor(node / cells), node % cells]
    const [col, row] = [cell % grid.cols, Math.floor(cell / grid.cols)]
    for (let d = 0; d < 8; d++) {
      const [c, r] = [col + (DCOL[d] as number), row + (DROW[d] as number)]
      if (c >= 0 && r >= 0 && c < grid.cols && r < grid.rows) visit(layer, r * grid.cols + c)
    }
    if (grid.via[cell] === FREE) for (let l = 0; l < grid.layers.length; l++) visit(l, cell)
  }
  return reached
}

/** The objects blocking a cell next to the reached ones, on the same layer. */
function border(grid: RouterGrid, reached: Uint8Array): Set<string> {
  const cells = grid.cols * grid.rows
  const found = new Set<string>()
  reached.forEach((hit, node) => {
    if (hit === 0) return
    const [layer, cell] = [Math.floor(node / cells), node % cells]
    const map = grid.track[layer] as Int32Array
    const [col, row] = [cell % grid.cols, Math.floor(cell / grid.cols)]
    for (let d = 0; d < 8; d++) {
      const [c, r] = [col + (DCOL[d] as number), row + (DROW[d] as number)]
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue
      const index = map[r * grid.cols + c] as number
      if (index !== FREE) found.add(grid.blockers[index] as string)
    }
  })
  return found
}

/** The names of the objects between the sources and the targets, in natural order. */
export function separating(grid: RouterGrid, sources: readonly CellRef[], targets: readonly CellRef[]): string[] {
  const [near, far] = [border(grid, flood(grid, sources)), border(grid, flood(grid, targets))]
  const both = [...near].filter((name) => far.has(name))
  const chosen = both.some((name) => name !== BOARD_EDGE) ? both : [...new Set([...near, ...far])]
  const names = chosen.sort(naturalCompare)
  return names.length > 1 ? names.filter((name) => name !== BOARD_EDGE) : names
}
