import { boardCopperLayers, type CopperLayer } from "../../core/layout-file.js"
import { usableOutline } from "../board.js"
import { copperPieces, padPieces, type ClassOf, type CopperPiece } from "../checks/copper-pieces.js"
import { bounds, pointInPolygon, shapeDistance, type Shape } from "../checks/geometry.js"
import type { Box } from "../checks/grid-index.js"
import type { Keepout, Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout } from "../pcb.js"
import { requiredClearance } from "../rules/classes.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import type { Rules } from "../rules/schema.js"
import type { ViaSize } from "../rules/track-defaults.js"

/**
 * The board rasterised for one net: a square grid of cells per copper layer, each cell free or blocked for the
 * centre line of the net's tracks, and one more map of the cells a via of the net may sit on.
 *
 * Every obstacle (copper and pads of other nets, keepouts, the board edge) is grown by the gap the copper checks
 * demand plus half the track width, so a centre line that stays at that distance is legal. A path runs straight
 * between neighbouring cell centres (along an axis or at 45°), and the copper between two free centres can come
 * nearer to an obstacle than the centres do. It cannot come nearer than √(R² − L²/4) when both centres are at least R
 * from the obstacle and L apart: the centres lie outside the disc of radius R around every point of the obstacle,
 * so the chord the move cuts through that disc is at most L long. The longest move is the diagonal, L = pitch·√2,
 * so a cell is free when its centre lies at least √(need² + pitch²/2) from every obstacle, and then every move
 * between free cells keeps the needed distance.
 */

/** A cell's state: free, or the index in `blockers` of the object that blocks it. */
export const FREE = -1
export const BOARD_EDGE = "board edge"

const PITCH_STEP = 0.05
const MIN_PITCH = 0.05
const MAX_PITCH = 0.25
/** Around the pads when there is no board outline, in mm. */
const NO_BOARD_MARGIN = 5
/** Rounds a coordinate to a nanometre, so the same cell always has the same centre. */
const toNanometre = (mm: number): number => Math.round(mm * 1e6) / 1e6

/** What the router lays for one net: its id, class, track width and via. */
export interface NetRule {
  net: string
  className: string
  width: number
  via: ViaSize
}

export interface RouterGrid {
  pitch: number
  /** Cell (col, row) has its centre at ((originCol + col) · pitch, (originRow + row) · pitch); cell = row · cols + col. */
  originCol: number
  originRow: number
  cols: number
  rows: number
  layers: readonly CopperLayer[]
  /** Per layer (as in `layers`), per cell: FREE, or what keeps a track's centre line out. */
  track: Int32Array[]
  /** Per cell: FREE, or what keeps a via of the net out. */
  via: Int32Array
  /** The names of the blocking objects: pad, track, via and keepout ids, and the board edge. */
  blockers: readonly string[]
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

export const cellCentre = (grid: RouterGrid, cell: number): Point => ({
  x: toNanometre((grid.originCol + (cell % grid.cols)) * grid.pitch),
  y: toNanometre((grid.originRow + Math.floor(cell / grid.cols)) * grid.pitch),
})

const pointShape = (p: Point): Shape => ({ core: [p], radius: 0 })

/** Visits each cell whose centre lies in the box, in row then column order. */
export function forCellsIn(grid: RouterGrid, box: Box, visit: (cell: number) => void): void {
  const col0 = Math.max(0, Math.ceil(box.minX / grid.pitch - 1e-9) - grid.originCol)
  const col1 = Math.min(grid.cols - 1, Math.floor(box.maxX / grid.pitch + 1e-9) - grid.originCol)
  const row0 = Math.max(0, Math.ceil(box.minY / grid.pitch - 1e-9) - grid.originRow)
  const row1 = Math.min(grid.rows - 1, Math.floor(box.maxY / grid.pitch + 1e-9) - grid.originRow)
  for (let row = row0; row <= row1; row++) for (let col = col0; col <= col1; col++) visit(row * grid.cols + col)
}

/** The cells whose centre lies on the shape's copper (an edge counts), in cell order. */
export function cellsOnShape(grid: RouterGrid, shape: Shape): number[] {
  const found: number[] = []
  forCellsIn(grid, bounds(shape), (cell) => {
    if (shapeDistance(shape, pointShape(cellCentre(grid, cell))) <= 0) found.push(cell)
  })
  return found
}

const grow = (box: Box, by: number): Box => ({ minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by })

/** Marks the free cells whose centre lies nearer than `reach` to the shape. */
function stamp(grid: RouterGrid, map: Int32Array, index: number, shape: Shape, reach: number): void {
  forCellsIn(grid, grow(bounds(shape), reach), (cell) => {
    if (map[cell] === FREE && shapeDistance(shape, pointShape(cellCentre(grid, cell))) < reach) map[cell] = index
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

function emptyGrid(layout: PcbLayout, pitch: number, blockers: readonly string[]): RouterGrid {
  const box = extent(layout) ?? { minX: 0, minY: 0, maxX: -1, maxY: -1 }
  const originCol = Math.ceil(box.minX / pitch - 1e-9)
  const originRow = Math.ceil(box.minY / pitch - 1e-9)
  const cols = Math.max(0, Math.floor(box.maxX / pitch + 1e-9) - originCol + 1)
  const rows = Math.max(0, Math.floor(box.maxY / pitch + 1e-9) - originRow + 1)
  const layers = boardCopperLayers(layout.board?.layers ?? 2)
  const blank = () => new Int32Array(cols * rows).fill(FREE)
  return { pitch, originCol, originRow, cols, rows, layers, track: layers.map(blank), via: blank(), blockers }
}

interface Context {
  grid: RouterGrid
  rules: Rules
  rule: NetRule
  indexOf: Map<string, number>
}

const layerMaps = (grid: RouterGrid, layers: readonly CopperLayer[]): Int32Array[] =>
  grid.layers.flatMap((layer, i) => (layers.includes(layer) ? [grid.track[i] as Int32Array] : []))

/** Copper or a pad of another net: kept out by the gap the two classes need, from tracks on its layers and from vias. */
function stampForeign({ grid, rules, rule, indexOf }: Context, piece: CopperPiece): void {
  const index = indexOf.get(piece.id) as number
  const gap = requiredClearance(rules, rule.className, piece.className)
  const maps = layerMaps(grid, piece.layers)
  for (const shape of piece.shapes) {
    for (const map of maps) stamp(grid, map, index, shape, centreReach(gap + rule.width / 2, grid.pitch))
    if (maps.length > 0) stamp(grid, grid.via, index, shape, gap + rule.via.diameter / 2)
  }
}

/** A pad of the net itself: tracks join it, but a via never sits on a pad. */
function stampOwnPad({ grid, rule, indexOf }: Context, piece: CopperPiece): void {
  const index = indexOf.get(piece.id) as number
  for (const shape of piece.shapes) stamp(grid, grid.via, index, shape, rule.via.diameter / 2)
}

/** A keepout keeps copper out of its inside, on its layers; a via spans every layer, so every keepout keeps it out. */
function stampKeepout({ grid, rule, indexOf }: Context, keepout: Keepout): void {
  const index = indexOf.get(keepout.id) as number
  const layers = keepout.layers === "all" ? grid.layers : [keepout.layers]
  for (const map of layerMaps(grid, layers)) {
    fill(grid, map, index, keepout.outline)
    for (const edge of edgesOf(keepout.outline)) stamp(grid, map, index, edge, centreReach(rule.width / 2, grid.pitch))
  }
  fill(grid, grid.via, index, keepout.outline)
  for (const edge of edgesOf(keepout.outline)) stamp(grid, grid.via, index, edge, rule.via.diameter / 2)
}

/** Outside the board, and nearer its edge than the fabrication minimum, is closed to every layer and to vias. */
function stampEdge({ grid, rules, rule, indexOf }: Context, outline: readonly Point[]): void {
  const index = indexOf.get(BOARD_EDGE) as number
  const minimum = rules.fabrication.boardEdgeClearance
  for (const map of grid.track) {
    fill(grid, map, index, outline, true)
    for (const edge of edgesOf(outline)) stamp(grid, map, index, edge, centreReach(minimum + rule.width / 2, grid.pitch))
  }
  fill(grid, grid.via, index, outline, true)
  for (const edge of edgesOf(outline)) stamp(grid, grid.via, index, edge, minimum + rule.via.diameter / 2)
}

/**
 * The grid for routing `rule.net` on the layout: pads, tracks and vias of other nets (and of no net), keepouts and
 * the board edge are obstacles; the net's own copper is not. `classOf` gives a net's class, as for the copper checks.
 * Where two objects block one cell, the first marked names it: other nets' copper and pads, the net's own pads (for
 * vias), keepouts, each kind in natural id order, then the board edge.
 */
export function rasterise(layout: PcbLayout, rules: Rules, classOf: ClassOf, rule: NetRule): RouterGrid {
  const pads = padPieces(layout, classOf)
  const copper = copperPieces(layout, classOf)
  const foreign = [...pads, ...copper].filter((piece) => piece.net !== rule.net)
  const own = pads.filter((piece) => piece.net === rule.net)
  const board = layout.board !== undefined && usableOutline(layout.board) ? layout.board : undefined
  const keepouts = (board?.keepouts ?? []).filter((keepout) => keepout.outline.length >= 3)
  const names = [...new Set([...foreign, ...own, ...keepouts].map((item) => item.id))].sort(naturalCompare)
  const blockers = board === undefined ? names : [...names, BOARD_EDGE]
  const grid = emptyGrid(layout, routerPitch(rules), blockers)
  const context: Context = { grid, rules, rule, indexOf: new Map(blockers.map((name, i) => [name, i])) }
  const byName = (a: { id: string }, b: { id: string }) => naturalCompare(a.id, b.id)
  for (const piece of [...foreign].sort(byName)) stampForeign(context, piece)
  for (const piece of [...own].sort(byName)) stampOwnPad(context, piece)
  for (const keepout of [...keepouts].sort(byName)) stampKeepout(context, keepout)
  if (board !== undefined) stampEdge(context, board.outline)
  return grid
}
