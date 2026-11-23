// Where the chips stand on the sheet: the chips in a grid, row by row, each column as far from the one before as its
// widest need; the connectors in a column at each edge, each as level as the column allows with the chip pins it
// meets. Rows wrap only when one row would be too wide, into as many as bring the page nearest a landscape page.
import type { Point } from "./model.js"
import { snapDown, snapUp, tidy } from "./schematic-geometry.js"
import { CLEARANCE } from "./schematic-place-units.js"
import type { Bounds } from "./symbols/index.js"

/** The least room between two chips side by side, and between connectors one above the other. */
export const ANCHOR_GAP = 1.0
/**
 * The least room between one row of chips and the next, with what hangs from them: enough that the supply pins of
 * the parts hanging below one row and above the next have room for their wires between them.
 */
const ROW_GAP = 1.5
/** Room between a column of connectors and the chips, for the wires between them. */
const EDGE_GAP = 1.0
/** The width over height a page of chips is wrapped towards. */
const TARGET_ASPECT = 1.5
/** A row of chips no wider than this stays one row. */
const ROW_LIMIT = 12

/** How far what hangs from a chip reaches beyond its bounds on each side. */
export interface Reach {
  left: number
  right: number
  up: number
  down: number
}

/** A chip, its bounds at rotation 0 and the reach of what hangs from it. */
export interface Cell {
  name: string
  bounds: Bounds
  reach: Reach
}

/** Origins by name, and the box they fill with all that hangs from them. */
export interface Block {
  origins: Map<string, Point>
  box: Bounds
}

/** The cells of the edge columns and of the grid between them, the grid's in reading order. */
export interface Cells {
  core: readonly Cell[]
  left: readonly Cell[]
  right: readonly Cell[]
}

const EMPTY: Bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 }

const top = (cell: Cell): number => cell.bounds.maxY + cell.reach.up
const bottom = (cell: Cell): number => cell.bounds.minY - cell.reach.down

function boxOf(cells: readonly Cell[], origins: ReadonlyMap<string, Point>): Bounds {
  if (cells.length === 0) return EMPTY
  const at = (cell: Cell): Point => origins.get(cell.name) ?? { x: 0, y: 0 }
  return {
    minX: Math.min(...cells.map((c) => at(c).x + c.bounds.minX - c.reach.left)),
    maxX: Math.max(...cells.map((c) => at(c).x + c.bounds.maxX + c.reach.right)),
    minY: Math.min(...cells.map((c) => at(c).y + bottom(c))),
    maxY: Math.max(...cells.map((c) => at(c).y + top(c))),
  }
}

/** The cells cut into rows of `columns`. */
function rowsOf(cells: readonly Cell[], columns: number): Cell[][] {
  const rows: Cell[][] = []
  for (let index = 0; index < cells.length; index += columns) rows.push(cells.slice(index, index + columns))
  return rows
}

/**
 * The cells in rows of `columns`, from x = 0, the first row's origins at y = 0 and each next row ROW_GAP below the
 * one before. A chip stands at least ANCHOR_GAP from its neighbour in the row, more when what hangs between them needs
 * it: `between(index)` is the room the gap after the cell at `index` needs for a part between the two.
 */
export function gridOf(cells: readonly Cell[], columns: number, between: (index: number) => number): Block {
  const size = Math.max(1, columns)
  const rows = rowsOf(cells, size)
  const origins = new Map<string, Point>()
  const width = Math.max(0, ...rows.map((row) => row.length))
  const ys: number[] = []
  for (const [k, row] of rows.entries()) {
    const previous = rows[k - 1]
    const y = previous === undefined ? 0 : snapDown((ys[k - 1] ?? 0) + Math.min(...previous.map(bottom)) - ROW_GAP - Math.max(...row.map(top)))
    ys.push(y)
  }
  let edge = Math.max(0, ...rows.map((row) => row[0]?.reach.left ?? 0))
  for (let column = 0; column < width; column++) {
    let next = -Infinity
    for (const [k, row] of rows.entries()) {
      const cell = row[column]
      if (!cell) continue
      const x = snapUp(edge - cell.bounds.minX)
      origins.set(cell.name, { x, y: ys[k] ?? 0 })
      const after = row[column + 1]
      if (!after) continue
      const gap = Math.max(ANCHOR_GAP, cell.reach.right + CLEARANCE + after.reach.left, between(k * size + column))
      next = Math.max(next, x + cell.bounds.maxX + gap)
    }
    edge = next
  }
  return { origins, box: boxOf(cells, origins) }
}

/**
 * The cells one under another, their reach left-aligned at x = 0, each at the origin y `wanted` gives it as far as
 * the column allows: highest wanted first, ties in the order given; one without a wish goes under the rest. No cell
 * reaches above `span.top`; a column that would reach below `span.bottom` is then lifted, from the bottom up, as
 * far as the room between its cells allows.
 */
export function stackOf(cells: readonly Cell[], wanted: (name: string) => number | undefined, span = { top: Infinity, bottom: -Infinity }): Block {
  const wish = (cell: Cell): number => wanted(cell.name) ?? -Infinity
  const order = cells.map((cell, index) => ({ cell, index })).sort((a, b) => wish(b.cell) - wish(a.cell) || a.index - b.index).map(({ cell }) => cell)
  const ys: number[] = []
  for (const [i, cell] of order.entries()) {
    const above = order[i - 1]
    const below = above === undefined ? Infinity : (ys[i - 1] ?? 0) + bottom(above) - ANCHOR_GAP - top(cell)
    ys.push(snapDown(Math.min(wanted(cell.name) ?? (above === undefined ? 0 : below), below, span.top - top(cell))))
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const [cell, under] = [order[i] as Cell, order[i + 1]]
    const lowest = under === undefined ? span.bottom - bottom(cell) : (ys[i + 1] ?? 0) + top(under) + ANCHOR_GAP - bottom(cell)
    if (lowest > (ys[i] ?? 0)) ys[i] = snapUp(lowest)
  }
  const origins = new Map(order.map((cell, i) => [cell.name, { x: snapUp(cell.reach.left - cell.bounds.minX), y: ys[i] ?? 0 }]))
  return { origins, box: boxOf(cells, origins) }
}

const widthOf = (box: Bounds): number => box.maxX - box.minX
const heightOf = (box: Bounds): number => box.maxY - box.minY

/** The width and height of the page: the grid with a stacked column of connectors at each edge that has any. */
function pageOf(grid: Bounds, cells: Cells): { width: number; height: number } {
  const sides = [cells.left, cells.right].filter((side) => side.length > 0).map((side) => stackOf(side, () => undefined).box)
  const gaps = cells.core.length > 0 ? sides.length * EDGE_GAP : Math.max(0, sides.length - 1) * EDGE_GAP
  const width = widthOf(grid) + gaps + sides.reduce((sum, box) => sum + widthOf(box), 0)
  return { width, height: Math.max(heightOf(grid), ...sides.map(heightOf)) }
}

/**
 * How many chips stand in a row: all of them while that row is no wider than ROW_LIMIT, else the count that brings
 * the page's width over height nearest TARGET_ASPECT, more columns on a tie. Rows are filled evenly: six chips stand
 * three and three, not four and two.
 */
export function columnsFor(cells: Cells, between: (index: number) => number): number {
  const count = cells.core.length
  if (count <= 1 || widthOf(gridOf(cells.core, count, between).box) <= ROW_LIMIT) return Math.max(1, count)
  let best = count
  let miss = Infinity
  for (let rows = 1; rows <= count; rows++) {
    const columns = Math.ceil(count / rows)
    if (columns === Math.ceil(count / (rows - 1))) continue
    const page = pageOf(gridOf(cells.core, columns, between).box, cells)
    const off = Math.abs(Math.log(Math.max(page.width, 1e-6) / Math.max(page.height, 1e-6) / TARGET_ASPECT))
    if (off < miss - 1e-9) [best, miss] = [columns, off]
  }
  return best
}

const shifted = (block: Block, dx: number): Map<string, Point> =>
  new Map([...block.origins].map(([name, at]) => [name, { x: tidy(at.x + dx), y: at.y }]))

/**
 * The origins of every chip: the left connectors from x = `start`, then the grid of `columns`, then the right
 * connectors, EDGE_GAP between each. `wanted` gives a connector the origin y that levels it with the chips it meets,
 * from the grid's origins.
 */
export function layoutOf(cells: Cells, columns: number, between: (index: number) => number, start: number, wanted: (name: string, grid: ReadonlyMap<string, Point>) => number | undefined): Map<string, Point> {
  const grid = gridOf(cells.core, columns, between)
  const wish = (name: string): number | undefined => wanted(name, grid.origins)
  const span = cells.core.length > 0 ? { top: grid.box.maxY, bottom: grid.box.minY } : undefined
  const left = stackOf(cells.left, wish, span)
  const right = stackOf(cells.right, wish, span)
  const origins = new Map<string, Point>()
  let x = start
  const add = (block: Block, count: number): void => {
    if (count === 0) return
    const dx = snapUp(x - block.box.minX)
    for (const [name, at] of shifted(block, dx)) origins.set(name, at)
    x = block.box.maxX + dx + EDGE_GAP
  }
  add(left, cells.left.length)
  add(grid, cells.core.length)
  add(right, cells.right.length)
  return origins
}
