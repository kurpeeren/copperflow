// The narrowest neck of an area of copper between the things it joins, measured on a grid so it is never read wider than
// the copper. A cell counts as copper only when its whole square is copper (its centre is inside and at least half a
// cell diagonal from every edge), so a slit narrower than a cell still cuts. Each copper cell's distance to the nearest
// cell that is not copper is the exact Euclidean distance transform; the widest path between two terminals is found by
// joining cells from the widest down until the terminals meet. Pure.
import type { Point } from "../model.js"
import { pointInPolygon } from "./geometry.js"

/**
 * Something the copper joins (a pad, a track, a via): `core`, the outlines of where the copper meets it; `spread`,
 * larger outlines within which the copper reached from the core counts as the terminal's too and is not measured.
 */
export interface Terminal {
  id: string
  core: readonly (readonly Point[])[]
  spread: readonly (readonly Point[])[]
}

/** One connected piece of the copper joining two terminals or more: its narrowest neck between them. */
export interface Neck {
  /** A width the copper is at least this wide along its widest path between all its terminals, in mm; Infinity when they meet without a neck. */
  width: number
  /** Where the neck is, in mm; absent when there is none. */
  at?: Point
  /** The terminals this piece joins, in the order given. */
  joined: string[]
}

/** How much narrower than the copper a neck can be read, as a multiple of the cell: see `narrowestNecks`. */
export const UNDER_READ = 6

const SQRT2 = Math.SQRT2
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
]

interface Grid {
  cols: number
  rows: number
  /** The centre of cell (0, 0) in mm. */
  x0: number
  y0: number
  cell: number
  /** 1 where the cell's whole square is copper. */
  copper: Uint8Array
  /** 1 where the cell is a terminal's. */
  zone: Uint8Array
}

function gridOver(rings: readonly (readonly Point[])[], cell: number): Grid {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const ring of rings) {
    for (const p of ring) {
      minX = Math.min(minX, p.x)
      minY = Math.min(minY, p.y)
      maxX = Math.max(maxX, p.x)
      maxY = Math.max(maxY, p.y)
    }
  }
  // Two cells of margin all round: the border cells are never copper, so every copper cell has a non-copper cell to measure to.
  const cols = Math.ceil((maxX - minX) / cell) + 4
  const rows = Math.ceil((maxY - minY) / cell) + 4
  return { cols, rows, x0: minX - 1.5 * cell, y0: minY - 1.5 * cell, cell, copper: new Uint8Array(cols * rows), zone: new Uint8Array(cols * rows) }
}

/** Marks the cells whose centres are inside the rings (even-odd), one row at a time. */
function fillInside(grid: Grid, rings: readonly (readonly Point[])[]): void {
  const { cols, rows, x0, y0, cell, copper } = grid
  const byRow: [Point, Point][][] = Array.from({ length: rows }, () => [])
  for (const ring of rings) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length] as Point
      if (a.y === b.y) return
      const first = Math.max(0, Math.ceil((Math.min(a.y, b.y) - y0) / cell))
      const last = Math.min(rows - 1, Math.floor((Math.max(a.y, b.y) - y0) / cell))
      for (let r = first; r <= last; r++) byRow[r]?.push([a, b])
    })
  }
  byRow.forEach((edges, r) => {
    const y = y0 + r * cell
    const xs = edges.filter(([a, b]) => a.y > y !== b.y > y).map(([a, b]) => a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y))
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.ceil(((xs[k] as number) - x0) / cell))
      const to = Math.min(cols - 1, Math.floor(((xs[k + 1] as number) - x0) / cell))
      for (let c = from; c <= to; c++) copper[r * cols + c] = 1
    }
  })
}

function segmentDistance(px: number, py: number, a: Point, b: Point): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / length))
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
}

/**
 * Clears every cell whose centre is within half a cell diagonal of an edge, so the cells left are wholly copper. The
 * edge is walked in half-cell steps; every centre that near the edge is in the 3 × 3 block round some step's cell.
 */
function clearEdges(grid: Grid, rings: readonly (readonly Point[])[]): void {
  const { cols, rows, x0, y0, cell, copper } = grid
  const reach = cell / SQRT2 + 1e-9
  for (const ring of rings) {
    ring.forEach((a, i) => {
      const b = ring[(i + 1) % ring.length] as Point
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (cell / 2)))
      for (let s = 0; s <= steps; s++) {
        const c = Math.round((a.x + ((b.x - a.x) * s) / steps - x0) / cell)
        const r = Math.round((a.y + ((b.y - a.y) * s) / steps - y0) / cell)
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const [cc, rr] = [c + dc, r + dr]
            if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue
            if (segmentDistance(x0 + cc * cell, y0 + rr * cell, a, b) <= reach) copper[rr * cols + cc] = 0
          }
        }
      }
    })
  }
}

/** Stands for "no feature on this line": far beyond any squared distance on a grid, yet exact when differenced. */
const FAR = 1e12

/** The squared distance transform of one line in place (Felzenszwalb and Huttenlocher): `f` is 0 or FAR in, squared distances out. */
function transformLine(f: Float64Array, n: number, v: Int32Array, z: Float64Array, d: Float64Array): void {
  const meet = (q: number, p: number) => ((f[q] as number) + q * q - ((f[p] as number) + p * p)) / (2 * (q - p))
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = meet(q, v[k] as number)
    while (k > 0 && s <= (z[k] as number)) {
      k--
      s = meet(q, v[k] as number)
    }
    if (k === 0 && s <= (z[0] as number)) v[0] = q
    else {
      k++
      v[k] = q
      z[k] = s
    }
    z[k + 1] = Infinity
  }
  let j = 0
  for (let q = 0; q < n; q++) {
    while ((z[j + 1] as number) < q) j++
    const p = v[j] as number
    d[q] = (q - p) * (q - p) + (f[p] as number)
  }
  for (let q = 0; q < n; q++) f[q] = d[q] as number
}

/** Each cell's squared distance, in cells, to the centre of the nearest cell that is not copper. */
function distances(grid: Grid): Float64Array {
  const { cols, rows, copper } = grid
  const out = new Float64Array(cols * rows)
  for (let i = 0; i < out.length; i++) out[i] = copper[i] === 1 ? FAR : 0
  const size = Math.max(cols, rows)
  const [line, v, z, d] = [new Float64Array(size), new Int32Array(size), new Float64Array(size + 1), new Float64Array(size)]
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) line[c] = out[r * cols + c] as number
    transformLine(line, cols, v, z, d)
    for (let c = 0; c < cols; c++) out[r * cols + c] = line[c] as number
  }
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) line[r] = out[r * cols + c] as number
    transformLine(line, rows, v, z, d)
    for (let r = 0; r < rows; r++) out[r * cols + c] = Math.round(line[r] as number)
  }
  return out
}

/** Union-find over the cells; `items` counts the terminals a set holds. */
class Sets {
  constructor(
    readonly parent: Int32Array,
    readonly items: Int32Array,
  ) {}
  static of(size: number): Sets {
    const parent = new Int32Array(size)
    for (let i = 0; i < size; i++) parent[i] = i
    return new Sets(parent, new Int32Array(size))
  }
  copy(): Sets {
    return new Sets(this.parent.slice(), this.items.slice())
  }
  find(i: number): number {
    let root = i
    while (this.parent[root] !== root) root = this.parent[root] as number
    while (i !== root) {
      const next = this.parent[i] as number
      this.parent[i] = root
      i = next
    }
    return root
  }
  join(a: number, b: number): void {
    const [ra, rb] = [this.find(a), this.find(b)]
    if (ra === rb) return
    this.parent[rb] = ra
    this.items[ra] = (this.items[ra] as number) + (this.items[rb] as number)
  }
}

/** The copper cells with centres inside one outline. */
function cellsInside(grid: Grid, outline: readonly Point[], into: Set<number>): void {
  if (outline.length < 3) return
  const { cols, rows, x0, y0, cell, copper } = grid
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  const [c0, c1] = [Math.max(0, Math.floor((Math.min(...xs) - x0) / cell)), Math.min(cols - 1, Math.ceil((Math.max(...xs) - x0) / cell))]
  const [r0, r1] = [Math.max(0, Math.floor((Math.min(...ys) - y0) / cell)), Math.min(rows - 1, Math.ceil((Math.max(...ys) - y0) / cell))]
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * cols + c
      if (copper[i] === 1 && pointInPolygon({ x: x0 + c * cell, y: y0 + r * cell }, outline)) into.add(i)
    }
  }
}

function forNeighbours(grid: Grid, i: number, visit: (j: number) => void): void {
  const [c, r] = [i % grid.cols, Math.floor(i / grid.cols)]
  for (const [dc, dr] of NEIGHBOURS) visit((r + dr) * grid.cols + (c + dc))
}

/** A terminal on the grid: the copper cells of its core (some may be another's core too), and the cells it owns. */
interface Found {
  index: number
  id: string
  seeds: number[]
  owned: number[]
}

/** Each copper cell's owner: the terminal whose core or spread holds it (-1 for none). */
interface Claims {
  found: Found[]
  owner: Int32Array
}

/**
 * Claims each terminal's cells: first every core (where two cores overlap, the first keeps the cell and the
 * terminals touch), then each spread, flooding from the terminal's own cells through cells no terminal owns yet, so
 * copper across a slit, or already another's, is not taken. A terminal with no copper in its core is left out.
 */
function claim(grid: Grid, terminals: readonly Terminal[]): Claims {
  const owner = new Int32Array(grid.copper.length).fill(-1)
  const found: Found[] = []
  terminals.forEach((terminal, index) => {
    const seeds = new Set<number>()
    for (const outline of terminal.core) cellsInside(grid, outline, seeds)
    if (seeds.size === 0) return
    const owned = [...seeds].filter((i) => owner[i] === -1)
    for (const i of owned) owner[i] = index
    found.push({ index, id: terminal.id, seeds: [...seeds], owned })
  })
  for (const terminal of found) {
    const within = new Set<number>()
    for (const outline of (terminals[terminal.index] as Terminal).spread) cellsInside(grid, outline, within)
    const stack = [...terminal.owned]
    for (let i = stack.pop(); i !== undefined; i = stack.pop()) {
      forNeighbours(grid, i, (j) => {
        if (owner[j] !== -1 || !within.has(j)) return
        owner[j] = terminal.index
        terminal.owned.push(j)
        stack.push(j)
      })
    }
  }
  return { found, owner }
}

/** Each terminal's cells joined into one set holding one terminal; terminals whose cores overlap share a set. */
function terminalSets(size: number, found: readonly Found[]): Sets {
  const sets = Sets.of(size)
  for (const terminal of found) {
    const first = terminal.seeds[0] as number
    const root = sets.find(first)
    sets.items[root] = (sets.items[root] as number) + 1
    for (const i of terminal.seeds) sets.join(first, i)
    for (const i of terminal.owned) sets.join(first, i)
  }
  return sets
}

/** The terminals of each connected piece of the grid's copper, by the piece's root. */
function gridPieces(grid: Grid, sets: Sets, found: readonly Found[]): { pieces: Sets; groups: Map<number, string[]> } {
  const pieces = sets.copy()
  for (let i = 0; i < grid.copper.length; i++) {
    if (grid.copper[i] === 1) forNeighbours(grid, i, (j) => grid.copper[j] === 1 && pieces.join(i, j))
  }
  const groups = new Map<number, string[]>()
  for (const terminal of found) {
    const piece = pieces.find(terminal.seeds[0] as number)
    groups.set(piece, [...(groups.get(piece) ?? []), terminal.id])
  }
  return { pieces, groups }
}

/** Copper cells by squared distance, widest first (a counting sort: the squared distances are whole numbers). */
function widestFirst(grid: Grid, squared: Float64Array): Int32Array {
  let top = 0
  for (let i = 0; i < squared.length; i++) if (grid.copper[i] === 1) top = Math.max(top, squared[i] as number)
  const counts = new Int32Array(top + 2)
  const slot = (i: number) => top - (squared[i] as number)
  for (let i = 0; i < squared.length; i++) if (grid.copper[i] === 1) counts[slot(i) + 1] = (counts[slot(i) + 1] as number) + 1
  for (let k = 1; k < counts.length; k++) counts[k] = (counts[k] as number) + (counts[k - 1] as number)
  const order = new Int32Array(counts[counts.length - 1] as number)
  for (let i = 0; i < squared.length; i++) {
    if (grid.copper[i] !== 1) continue
    const at = counts[slot(i)] as number
    order[at] = i
    counts[slot(i)] = at + 1
  }
  return order
}

const centreOf = (grid: Grid, i: number): Point => ({ x: grid.x0 + (i % grid.cols) * grid.cell, y: grid.y0 + Math.floor(i / grid.cols) * grid.cell })

/**
 * Joins cells from the widest down until each open piece's terminals are one set. A cell joins a neighbour already
 * joined in, and a neighbour in a terminal's spread when it is not in a spread itself (stepping into a spread is free);
 * where two terminals' spreads meet, the copper is measured like any other.
 */
function sweep(grid: Grid, sets: Sets, owner: Int32Array, settle: (i: number, width: number) => boolean): void {
  const squared = distances(grid)
  const order = widestFirst(grid, squared)
  const done = new Uint8Array(grid.copper.length)
  for (let k = 0; k < order.length; k++) {
    const i = order[k] as number
    done[i] = 1
    const free = owner[i] === -1
    forNeighbours(grid, i, (j) => {
      if (done[j] === 1 || (owner[j] !== -1 && (free || owner[j] === owner[i]))) sets.join(i, j)
    })
    if (settle(i, Math.max(0, 2 * (Math.sqrt(squared[i] as number) - SQRT2) * grid.cell))) return
  }
}

/**
 * For each connected piece of the copper (`rings`, even-odd, in mm) that joins two terminals or more, a width the copper
 * is at least as wide as along its widest path between all of them, measured on a grid of `cell` mm; the copper in a
 * terminal's spread is not measured, but where two spreads meet it is. The width is never more than the copper's: a
 * disc of the read half-width round every point of that path is copper. It reads at most `UNDER_READ` cells narrower.
 * Copper thinner than the grid can hold is no copper on it: callers that know which terminals the copper truly joins
 * check them with `unread`.
 */
export function narrowestNecks(rings: readonly (readonly Point[])[], terminals: readonly Terminal[], cell: number): Neck[] {
  if (rings.length === 0) return []
  const grid = gridOver(rings, cell)
  fillInside(grid, rings)
  clearEdges(grid, rings)
  const { found, owner } = claim(grid, terminals)
  const sets = terminalSets(grid.copper.length, found)
  const { pieces, groups } = gridPieces(grid, sets, found)
  const open = new Map([...groups].filter(([, ids]) => ids.length >= 2))
  const necks: Neck[] = []
  const settle = (i: number, width: number): boolean => {
    const piece = pieces.find(i)
    const ids = open.get(piece)
    if (ids !== undefined && sets.items[sets.find(i)] === ids.length) {
      necks.push({ width, ...(width === Infinity ? {} : { at: centreOf(grid, i) }), joined: ids })
      open.delete(piece)
    }
    return open.size === 0
  }
  for (const terminal of found) if (settle(terminal.seeds[0] as number, Infinity)) return necks
  sweep(grid, sets, owner, settle)
  return necks
}

/**
 * The terminals that copper truly joins (`together`, each list one piece of the true copper) but the grid's necks do
 * not: where one of those lists is not wholly in one neck's `joined`, the copper between them is thinner than the grid
 * can hold. One list of the ids that are, for each such piece.
 */
export function unread(necks: readonly Neck[], together: readonly (readonly string[])[]): string[][] {
  return together.filter((ids) => ids.length >= 2 && !necks.some((neck) => ids.every((id) => neck.joined.includes(id)))).map((ids) => [...ids])
}
