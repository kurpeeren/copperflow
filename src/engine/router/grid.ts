import { boardCopperLayers, type CopperLayer } from "../../core/layout-file.js"
import { usableOutline } from "../board.js"
import type { ClassOf } from "../checks/copper-pieces.js"
import { bounds, pointInPolygon, shapeDistance, type Shape } from "../checks/geometry.js"
import { GridIndex, type Box } from "../checks/grid-index.js"
import type { Board, Hole, Keepout, Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout } from "../pcb.js"
import { requiredClearance } from "../rules/classes.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import type { Rules } from "../rules/schema.js"
import type { ViaSize } from "../rules/track-defaults.js"
import { obstaclesOf, type Obstacle } from "./obstacles.js"

/**
 * The board rasterised for one net: a square grid of cells per copper layer, each cell free or blocked for the
 * centre line of the net's tracks, and one more map of the cells a via of the net may sit on.
 *
 * Every obstacle (copper and pads of other nets, keepouts, non-plated holes, the board edge) is grown by the gap the copper checks
 * demand plus half the track width, so a centre line that stays at that distance is legal. A path runs straight
 * between neighbouring cell centres (along an axis or at 45°), and the copper between two free centres can come
 * nearer to an obstacle than the centres do. It cannot come nearer than √(R² − L²/4) when both centres are at least R
 * from the obstacle and L apart: the centres lie outside the disc of radius R around every point of the obstacle,
 * so the chord the move cuts through that disc is at most L long. The longest move is the diagonal, L = pitch·√2,
 * so a cell is free when its centre lies at least √(need² + pitch²/2) from every obstacle, and then every move
 * between free cells keeps the needed distance.
 *
 * A via also keeps the fabrication hole spacing from every hole (through pads and vias, its own net's included).
 *
 * The board is prepared once (`routerWorld`): its obstacles in a spatial index, and per track width and via size the
 * maps of what does not depend on the net (keepouts, holes and the board edge). A grid is then made for one net over a
 * window of the board's cells, from those maps and the obstacles near the window.
 */

/** A cell's state: free, or the index in `blockers` of the object that blocks it. */
export const FREE = -1
export const BOARD_EDGE = "board edge"

const PITCH_STEP = 0.05
const MIN_PITCH = 0.05
const MAX_PITCH = 0.25
/** Around the pads when there is no board outline, in mm. */
const NO_BOARD_MARGIN = 5
/** The spatial index's cell, in mm. */
const INDEX_CELL = 2
/** Rounds a coordinate to a nanometre, so the same cell always has the same centre. */
const toNanometre = (mm: number): number => Math.round(mm * 1e6) / 1e6

/** What the router lays for one net: its id, class, track width and via. */
export interface NetRule {
  net: string
  className: string
  width: number
  via: ViaSize
}

/** Where a grid's cells are: cell (col, row) has its centre at ((originCol + col) · pitch, (originRow + row) · pitch). */
export interface GridFrame {
  pitch: number
  originCol: number
  originRow: number
  cols: number
  rows: number
  layers: readonly CopperLayer[]
}

export interface RouterGrid extends GridFrame {
  /** Per layer (as in `layers`), per cell (row · cols + col): FREE, or what keeps a track's centre line out. */
  track: Int32Array[]
  /** Per cell: FREE, or what keeps a via of the net out. */
  via: Int32Array
  /** The names of the blocking objects: pad, track, via and keepout ids, and the board edge. */
  blockers: readonly string[]
}

/** A range of the board's cells, inclusive, counted from the board grid's first cell. */
export interface CellWindow {
  col0: number
  row0: number
  col1: number
  row1: number
}

/** What does not depend on the net, for one track width and via size: keepouts, holes and the board edge. */
interface Base {
  track: Int32Array[]
  via: Int32Array
  names: string[]
}

/** The board prepared for routing: its cells, its obstacles in an index, and the net-free maps per width and via. */
export interface RouterWorld {
  layout: PcbLayout
  rules: Rules
  classOf: ClassOf
  /** The whole board's grid, without obstacles. */
  frame: GridFrame
  board?: Board
  keepouts: readonly Keepout[]
  /** The non-plated holes, which tracks and vias keep the board-edge clearance from. */
  holes: readonly Hole[]
  /** Pads and the layout's copper, in natural id order. */
  obstacles: readonly Obstacle[]
  index: GridIndex<Obstacle>
  /** The widest gap any two classes need, for how far around a window obstacles still matter. */
  widestGap: number
  bases: Map<string, Base>
}

/**
 * The grid pitch the rules give: half of the smallest track width plus clearance among the net classes (the default
 * class included, each raised to the fabrication minimums), rounded to 0.05 mm and kept within 0.05–0.25 mm.
 */
export function routerPitch(rules: Rules): number {
  const { minTrackWidth, minClearance } = rules.fabrication
  const sums = [DEFAULT_CLASS, ...rules.classes].map((c) => Math.max(c.trackWidth, minTrackWidth) + Math.max(c.clearance, minClearance))
  const steps = Math.round(toNanometre(Math.min(...sums) / 2 / PITCH_STEP))
  return toNanometre(Math.min(Math.max(steps * PITCH_STEP, MIN_PITCH), MAX_PITCH))
}

/** The distance from an obstacle a free cell centre keeps, so moves between free cells keep `need` (see above). */
export const centreReach = (need: number, pitch: number): number => Math.sqrt(need * need + (pitch * pitch) / 2)

export const cellCentre = (grid: GridFrame, cell: number): Point => ({
  x: toNanometre((grid.originCol + (cell % grid.cols)) * grid.pitch),
  y: toNanometre((grid.originRow + Math.floor(cell / grid.cols)) * grid.pitch),
})

const pointShape = (p: Point): Shape => ({ core: [p], radius: 0 })

/** Visits each cell whose centre lies in the box, in row then column order. */
export function forCellsIn(grid: GridFrame, box: Box, visit: (cell: number) => void): void {
  const col0 = Math.max(0, Math.ceil(box.minX / grid.pitch - 1e-9) - grid.originCol)
  const col1 = Math.min(grid.cols - 1, Math.floor(box.maxX / grid.pitch + 1e-9) - grid.originCol)
  const row0 = Math.max(0, Math.ceil(box.minY / grid.pitch - 1e-9) - grid.originRow)
  const row1 = Math.min(grid.rows - 1, Math.floor(box.maxY / grid.pitch + 1e-9) - grid.originRow)
  for (let row = row0; row <= row1; row++) for (let col = col0; col <= col1; col++) visit(row * grid.cols + col)
}

/** The cells whose centre lies on the shape's copper (an edge counts), in cell order. */
export function cellsOnShape(grid: GridFrame, shape: Shape): number[] {
  const found: number[] = []
  forCellsIn(grid, bounds(shape), (cell) => {
    if (shapeDistance(shape, pointShape(cellCentre(grid, cell))) <= 0) found.push(cell)
  })
  return found
}

export const grow = (box: Box, by: number): Box => ({ minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by })

/** Visits the cells whose centre lies nearer than `reach` to the shape. */
export function cellsNear(grid: GridFrame, shape: Shape, reach: number, visit: (cell: number) => void): void {
  forCellsIn(grid, grow(bounds(shape), reach), (cell) => {
    if (shapeDistance(shape, pointShape(cellCentre(grid, cell))) < reach) visit(cell)
  })
}

/** Marks the cells near the shape that are free or blocked only by the net-free maps (`below`): an object names a cell first. */
function stamp(grid: RouterGrid, map: Int32Array, index: number, shape: Shape, reach: number, below: number): void {
  cellsNear(grid, shape, reach, (cell) => {
    const now = map[cell] as number
    if (now === FREE || now < below) map[cell] = index
  })
}

/** Marks the free cells whose centre lies inside (or outside, with `outside`) the polygon. */
function fill(grid: RouterGrid, map: Int32Array, index: number, polygon: readonly Point[], outside = false): void {
  const box = outside ? { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity } : bounds({ core: [...polygon], radius: 0 })
  forCellsIn(grid, box, (cell) => {
    if (map[cell] === FREE && pointInPolygon(cellCentre(grid, cell), polygon) !== outside) map[cell] = index
  })
}

const edgesOf = (polygon: readonly Point[]): Shape[] => polygon.map((p, i) => ({ core: [p, polygon[(i + 1) % polygon.length] as Point], radius: 0 }))

function extent(layout: PcbLayout): Box | undefined {
  if (layout.board !== undefined && usableOutline(layout.board)) return bounds({ core: layout.board.outline, radius: 0 })
  const centres = layout.parts.flatMap((part) => part.pads).map((pad) => ({ x: pad.x, y: pad.y }))
  return centres.length === 0 ? undefined : grow(bounds({ core: centres, radius: 0 }), NO_BOARD_MARGIN)
}

function frameOf(layout: PcbLayout, pitch: number): GridFrame {
  const box = extent(layout) ?? { minX: 0, minY: 0, maxX: -1, maxY: -1 }
  const originCol = Math.ceil(box.minX / pitch - 1e-9)
  const originRow = Math.ceil(box.minY / pitch - 1e-9)
  const cols = Math.max(0, Math.floor(box.maxX / pitch + 1e-9) - originCol + 1)
  const rows = Math.max(0, Math.floor(box.maxY / pitch + 1e-9) - originRow + 1)
  return { pitch, originCol, originRow, cols, rows, layers: boardCopperLayers(layout.board?.layers ?? 2) }
}

/** Prepares the layout for routing: the board grid, the obstacles and their index. `classOf` gives a net's class. */
export function routerWorld(layout: PcbLayout, rules: Rules, classOf: ClassOf): RouterWorld {
  const board = layout.board !== undefined && usableOutline(layout.board) ? layout.board : undefined
  const obstacles = obstaclesOf(layout, classOf)
  const index = new GridIndex<Obstacle>(INDEX_CELL)
  for (const obstacle of obstacles) index.insert(obstacle, obstacle.box)
  const names = [DEFAULT_CLASS.name, ...rules.classes.map((c) => c.name)]
  const widestGap = Math.max(...names.flatMap((a) => names.map((b) => requiredClearance(rules, a, b))))
  return {
    layout,
    rules,
    classOf,
    frame: frameOf(layout, routerPitch(rules)),
    ...(board === undefined ? {} : { board }),
    keepouts: (board?.keepouts ?? []).filter((keepout) => keepout.outline.length >= 3),
    holes: layout.holes,
    obstacles,
    index,
    widestGap,
    bases: new Map(),
  }
}

const layerMaps = (grid: RouterGrid, layers: readonly CopperLayer[]): Int32Array[] =>
  grid.layers.flatMap((layer, i) => (layers.includes(layer) ? [grid.track[i] as Int32Array] : []))

/** A non-plated hole: tracks on every layer and vias keep the board-edge clearance from its edge. */
function stampHoleClearance(world: RouterWorld, grid: RouterGrid, rule: NetRule, hole: Hole, index: number): void {
  const minimum = world.rules.fabrication.boardEdgeClearance
  const disc: Shape = { core: [{ x: hole.x, y: hole.y }], radius: hole.diameter / 2 }
  for (const map of grid.track) stamp(grid, map, index, disc, centreReach(minimum + rule.width / 2, grid.pitch), 0)
  stamp(grid, grid.via, index, disc, minimum + rule.via.diameter / 2, 0)
}

/** Keepouts, holes and the board edge over the whole board, for one track width and via size. */
function baseOf(world: RouterWorld, rule: NetRule): Base {
  const key = `${rule.width}|${rule.via.diameter}`
  const known = world.bases.get(key)
  if (known !== undefined) return known
  const keepouts = [...world.keepouts].sort((a, b) => naturalCompare(a.id, b.id))
  const holes = [...world.holes].sort((a, b) => naturalCompare(a.id, b.id))
  const names = [...keepouts.map((keepout) => keepout.id), ...holes.map((hole) => hole.id), ...(world.board === undefined ? [] : [BOARD_EDGE])]
  const blank = () => new Int32Array(world.frame.cols * world.frame.rows).fill(FREE)
  const grid: RouterGrid = { ...world.frame, track: world.frame.layers.map(blank), via: blank(), blockers: names }
  const { pitch } = grid
  keepouts.forEach((keepout, index) => {
    const layers = keepout.layers === "all" ? grid.layers : [keepout.layers]
    for (const map of layerMaps(grid, layers)) {
      fill(grid, map, index, keepout.outline)
      for (const edge of edgesOf(keepout.outline)) stamp(grid, map, index, edge, centreReach(rule.width / 2, pitch), 0)
    }
    fill(grid, grid.via, index, keepout.outline)
    for (const edge of edgesOf(keepout.outline)) stamp(grid, grid.via, index, edge, rule.via.diameter / 2, 0)
  })
  holes.forEach((hole, i) => stampHoleClearance(world, grid, rule, hole, keepouts.length + i))
  if (world.board !== undefined) {
    const index = keepouts.length + holes.length
    const { outline } = world.board
    const minimum = world.rules.fabrication.boardEdgeClearance
    for (const map of grid.track) {
      fill(grid, map, index, outline, true)
      for (const edge of edgesOf(outline)) stamp(grid, map, index, edge, centreReach(minimum + rule.width / 2, pitch), 0)
    }
    fill(grid, grid.via, index, outline, true)
    for (const edge of edgesOf(outline)) stamp(grid, grid.via, index, edge, minimum + rule.via.diameter / 2, 0)
  }
  const base = { track: grid.track, via: grid.via, names }
  world.bases.set(key, base)
  return base
}

/** The window's own frame: the board's cells from the window's first one. */
export function windowFrame(world: RouterWorld, window: CellWindow): GridFrame {
  const { frame } = world
  return { ...frame, originCol: frame.originCol + window.col0, originRow: frame.originRow + window.row0, cols: window.col1 - window.col0 + 1, rows: window.row1 - window.row0 + 1 }
}

/** The net-free maps copied into the window's cells. */
function windowGrid(world: RouterWorld, base: Base, window: CellWindow): RouterGrid {
  const frame = windowFrame(world, window)
  const copy = (whole: Int32Array) => {
    const part = new Int32Array(frame.cols * frame.rows)
    for (let row = 0; row < frame.rows; row++) {
      const from = (window.row0 + row) * world.frame.cols + window.col0
      part.set(whole.subarray(from, from + frame.cols), row * frame.cols)
    }
    return part
  }
  return { ...frame, track: base.track.map(copy), via: copy(base.via), blockers: base.names }
}

/** The whole board as a window. */
export const wholeBoard = (world: RouterWorld): CellWindow => ({ col0: 0, row0: 0, col1: world.frame.cols - 1, row1: world.frame.rows - 1 })

/** The window's area in mm, from its first cell centre to its last. */
export function windowBox(world: RouterWorld, window: CellWindow): Box {
  const { pitch, originCol, originRow } = world.frame
  return { minX: (originCol + window.col0) * pitch, minY: (originRow + window.row0) * pitch, maxX: (originCol + window.col1) * pitch, maxY: (originRow + window.row1) * pitch }
}

/** The board's cells within the box (at least one cell, the nearest, when the box misses the board). */
export function windowAround(world: RouterWorld, box: Box): CellWindow {
  const { pitch, originCol, originRow, cols, rows } = world.frame
  const clamp = (value: number, last: number) => Math.min(Math.max(value, 0), last)
  const col0 = clamp(Math.ceil(box.minX / pitch - 1e-9) - originCol, cols - 1)
  const row0 = clamp(Math.ceil(box.minY / pitch - 1e-9) - originRow, rows - 1)
  const col1 = clamp(Math.floor(box.maxX / pitch + 1e-9) - originCol, cols - 1)
  const row1 = clamp(Math.floor(box.maxY / pitch + 1e-9) - originRow, rows - 1)
  return { col0: Math.min(col0, col1), row0: Math.min(row0, row1), col1: Math.max(col0, col1), row1: Math.max(row0, row1) }
}

export const isWholeBoard = (world: RouterWorld, window: CellWindow): boolean =>
  window.col0 === 0 && window.row0 === 0 && window.col1 === world.frame.cols - 1 && window.row1 === world.frame.rows - 1

/** How far from an obstacle the net's tracks, vias and holes are kept, at most: the reach of the index query. */
export function farthestReach(world: RouterWorld, rule: NetRule): number {
  const { pitch } = world.frame
  const holes = rule.via.drill / 2 + world.rules.fabrication.minHoleToHole
  return Math.max(centreReach(world.widestGap + rule.width / 2, pitch), world.widestGap + rule.via.diameter / 2, holes)
}

/** The reaches the net keeps from another net's copper of class `className`: track centres, and via centres. */
export function foreignReach(world: RouterWorld, rule: NetRule, className: string): { track: number; via: number } {
  const gap = requiredClearance(world.rules, rule.className, className)
  return { track: centreReach(gap + rule.width / 2, world.frame.pitch), via: gap + rule.via.diameter / 2 }
}

interface Stamping {
  world: RouterWorld
  grid: RouterGrid
  rule: NetRule
  below: number
}

/** Copper or a pad of another net: kept out by the gap the two classes need, from tracks on its layers and from vias. */
function stampForeign({ world, grid, rule, below }: Stamping, piece: Obstacle, index: number): void {
  const reach = foreignReach(world, rule, piece.className)
  const maps = layerMaps(grid, piece.layers)
  for (const shape of piece.shapes) {
    for (const map of maps) stamp(grid, map, index, shape, reach.track, below)
    if (maps.length > 0) stamp(grid, grid.via, index, shape, reach.via, below)
  }
}

/** A pad of the net itself: tracks join it, but a via never sits on a pad. */
function stampOwnPad({ grid, rule, below }: Stamping, piece: Obstacle, index: number): void {
  for (const shape of piece.shapes) stamp(grid, grid.via, index, shape, rule.via.diameter / 2, below)
}

/** A hole of any net: a via keeps the fabrication hole spacing from it. */
function stampHole({ world, grid, rule, below }: Stamping, piece: Obstacle, index: number): void {
  if (piece.hole !== undefined) stamp(grid, grid.via, index, piece.hole, rule.via.drill / 2 + world.rules.fabrication.minHoleToHole, below)
}

/**
 * The grid for routing `rule.net` over a window of the board (the whole board by default): pads, tracks and vias of
 * other nets (and of no net), keepouts, holes and the board edge are obstacles; the net's own copper is not, but its pads
 * keep vias off and every hole keeps vias at the hole spacing. `extra` is more copper to keep out the same way, such
 * as what the router laid earlier in a run. Where two objects block one cell, the first marked names it: other nets'
 * copper and pads (the layout's, then `extra`), the net's own pads, then holes, each in natural id order; then
 * keepouts, then non-plated holes, then the board edge.
 */
export function rasteriseIn(world: RouterWorld, rule: NetRule, window: CellWindow = wholeBoard(world), extra: readonly Obstacle[] = []): RouterGrid {
  const base = baseOf(world, rule)
  const grid = windowGrid(world, base, window)
  const near = world.index.query(grow(windowBox(world, window), farthestReach(world, rule)))
  const byName = (a: { id: string }, b: { id: string }) => naturalCompare(a.id, b.id)
  const layout = [...near].sort(byName)
  const added = [...extra].sort(byName)
  const foreign = [...layout, ...added].filter((piece) => piece.net !== rule.net)
  const ownPads = layout.filter((piece) => piece.net === rule.net && piece.kind === "pad")
  const holes = [...layout, ...added].filter((piece) => piece.hole !== undefined)
  const names = [...base.names]
  const indexOf = new Map<string, number>()
  const nameIndex = (id: string) => {
    const known = indexOf.get(id)
    if (known !== undefined) return known
    indexOf.set(id, names.length)
    names.push(id)
    return names.length - 1
  }
  const stamping: Stamping = { world, grid, rule, below: base.names.length }
  for (const piece of foreign) stampForeign(stamping, piece, nameIndex(piece.id))
  for (const piece of ownPads) stampOwnPad(stamping, piece, nameIndex(piece.id))
  for (const piece of holes) stampHole(stamping, piece, nameIndex(piece.id))
  return { ...grid, blockers: names }
}

/** The grid for routing `rule.net` over the whole layout. `classOf` gives a net's class, as for the copper checks. */
export function rasterise(layout: PcbLayout, rules: Rules, classOf: ClassOf, rule: NetRule): RouterGrid {
  return rasteriseIn(routerWorld(layout, rules, classOf), rule)
}

export type { Obstacle }
