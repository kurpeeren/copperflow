export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * The most cells one box visits. An item over more cells goes in a flat list that every query
 * returns, and a query over more cells returns every item, so a mistyped size of metres costs a
 * longer list to filter, not millions of cells.
 */
export const MAX_BOX_CELLS = 4096

interface CellRange {
  x0: number
  x1: number
  y0: number
  y1: number
}

const cellCount = ({ x0, x1, y0, y1 }: CellRange): number => Math.max(0, x1 - x0 + 1) * Math.max(0, y1 - y0 + 1)

/** A uniform grid over the plane. Items are listed in every cell their box touches. */
export class GridIndex<T> {
  private readonly cells = new Map<string, T[]>()
  /** Items whose box covers more than MAX_BOX_CELLS cells. */
  private readonly wide: T[] = []

  constructor(private readonly cell: number) {
    if (!(cell > 0)) throw new Error(`Grid cell size must be positive, got ${cell}`)
  }

  insert(item: T, box: Box): void {
    const range = this.rangeOf(box)
    if (cellCount(range) > MAX_BOX_CELLS) {
      this.wide.push(item)
      return
    }
    forEachCell(range, (key) => {
      const items = this.cells.get(key)
      if (items === undefined) this.cells.set(key, [item])
      else items.push(item)
    })
  }

  /** Items whose cells touch the box, and the wide items, each once. They may lie outside the box itself. */
  query(box: Box): T[] {
    const range = this.rangeOf(box)
    const found = new Set<T>(this.wide)
    const add = (items: readonly T[] | undefined) => items?.forEach((item) => found.add(item))
    if (cellCount(range) > MAX_BOX_CELLS) this.cells.forEach(add)
    else forEachCell(range, (key) => add(this.cells.get(key)))
    return [...found]
  }

  private rangeOf(box: Box): CellRange {
    if (![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) {
      throw new Error(`Grid box must have finite bounds, got ${JSON.stringify(box)}`)
    }
    const at = (value: number) => Math.floor(value / this.cell)
    return { x0: at(box.minX), x1: at(box.maxX), y0: at(box.minY), y1: at(box.maxY) }
  }
}

function forEachCell({ x0, x1, y0, y1 }: CellRange, visit: (key: string) => void): void {
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) visit(`${cx},${cy}`)
}
