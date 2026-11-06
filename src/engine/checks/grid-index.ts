export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** A uniform grid over the plane. Items are listed in every cell their box touches. */
export class GridIndex<T> {
  private readonly cells = new Map<string, T[]>()

  constructor(private readonly cell: number) {
    if (!(cell > 0)) throw new Error(`Grid cell size must be positive, got ${cell}`)
  }

  insert(item: T, box: Box): void {
    this.forEachCell(box, (key) => {
      const items = this.cells.get(key)
      if (items === undefined) this.cells.set(key, [item])
      else items.push(item)
    })
  }

  /** Items whose cells touch the box, each once. They may lie slightly outside the box itself. */
  query(box: Box): T[] {
    const found = new Set<T>()
    this.forEachCell(box, (key) => {
      for (const item of this.cells.get(key) ?? []) found.add(item)
    })
    return [...found]
  }

  private forEachCell(box: Box, visit: (key: string) => void): void {
    if (![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) {
      throw new Error(`Grid box must have finite bounds, got ${JSON.stringify(box)}`)
    }
    const x0 = Math.floor(box.minX / this.cell)
    const x1 = Math.floor(box.maxX / this.cell)
    const y0 = Math.floor(box.minY / this.cell)
    const y1 = Math.floor(box.maxY / this.cell)
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) visit(`${cx},${cy}`)
  }
}
