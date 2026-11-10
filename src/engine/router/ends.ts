import type { CopperLayer } from "../../core/layout-file.js"
import { copperTouches, padsUnder } from "../copper.js"
import { copperPieces, padPieces, type CopperPiece } from "../checks/copper-pieces.js"
import type { Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout, WorldPad } from "../pcb.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import { STEP, type CellRef, type EndRef } from "./astar.js"
import { offenders, type Laid } from "./clear.js"
import { BOARD_EDGE, cellCentre, cellsOnShape, forCellsIn, FREE, type NetRule, type RouterGrid, type RouterWorld } from "./grid.js"
import type { Obstacle } from "./obstacles.js"

/**
 * Where a connection may start or end: the pad, every pad its net's copper already joins to it, and that copper
 * (tracks and vias of the net), as the free cells whose centre lies on their copper. A track ending on such a cell
 * touches that copper, so copper.ts joins it to the pad.
 */

const asDefault = () => DEFAULT_CLASS.name

class Groups {
  private readonly parent: number[]
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i)
  }
  find(i: number): number {
    while (this.parent[i] !== i) i = this.parent[i] as number
    return i
  }
  join(a: number, b: number): void {
    const [ra, rb] = [this.find(a), this.find(b)]
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
}

const shareLayer = (a: CopperPiece, b: CopperPiece) => a.layers.some((layer) => b.layers.includes(layer))

/** A track joins the pads copper.ts listed for it; a via the pads under its centre; copper the copper it touches. */
function joined(layout: PcbLayout, a: CopperPiece, b: CopperPiece): boolean {
  if (a.kind === "pad" && b.kind === "pad") return false
  if (b.kind === "pad") return joined(layout, b, a)
  if (a.kind === "pad") {
    if (b.kind === "track") return b.pads?.includes(a.id) ?? false
    return b.layers.some((layer) => padsUnder(layout.parts, b.at, layer).some((pad) => pad.id === a.id))
  }
  return shareLayer(a, b) && a.shapes.some((sa) => b.shapes.some((sb) => copperTouches(sa, sb)))
}

/** The net's pads and copper already joined to the pad, the pad first, then in natural id order. */
export function joinedTo(layout: PcbLayout, padId: string): CopperPiece[] {
  const pads = padPieces(layout, asDefault)
  const net = pads.find((piece) => piece.id === padId)?.net
  if (net === undefined) return pads.filter((piece) => piece.id === padId)
  const pieces = [...pads, ...copperPieces(layout, asDefault)].filter((piece) => piece.net === net)
  const groups = new Groups(pieces.length)
  pieces.forEach((a, i) => pieces.forEach((b, j) => j > i && joined(layout, a, b) && groups.join(i, j)))
  const root = groups.find(pieces.findIndex((piece) => piece.id === padId))
  const group = pieces.filter((_, i) => groups.find(i) === root)
  return [...group.filter((piece) => piece.id === padId), ...group.filter((piece) => piece.id !== padId)]
}

/** The free cells on the pieces' copper, on each of their layers the grid has, each once, in layer then cell order. */
export function endCells(grid: RouterGrid, pieces: readonly CopperPiece[]): CellRef[] {
  const seen = new Set<number>()
  grid.layers.forEach((layer, l) => {
    const map = grid.track[l] as Int32Array
    for (const piece of pieces.filter((p) => p.layers.includes(layer))) {
      for (const shape of piece.shapes) for (const cell of cellsOnShape(grid, shape)) if (map[cell] === FREE) seen.add(l * grid.cols * grid.rows + cell)
    }
  })
  const cells = grid.cols * grid.rows
  return [...seen].sort((a, b) => a - b).map((node) => ({ layer: Math.floor(node / cells), cell: node % cells }))
}

/** The net's pads and copper in the groups its copper joins, each group in natural id order, groups by their first. */
export function islandsOf(layout: PcbLayout, pieces: readonly Obstacle[]): Obstacle[][] {
  const groups = new Groups(pieces.length)
  pieces.forEach((a, i) => pieces.forEach((b, j) => j > i && joined(layout, a, b) && groups.join(i, j)))
  const byRoot = new Map<number, Obstacle[]>()
  pieces.forEach((piece, i) => {
    const root = groups.find(i)
    byRoot.set(root, [...(byRoot.get(root) ?? []), piece])
  })
  return [...byRoot.values()].map((group) => [...group].sort((a, b) => naturalCompare(a.id, b.id)))
}

/** How far from a pad's centre a leg may reach a free cell, beyond the pad itself, in mm. */
const LEG_REACH = 1
/** The legs kept per pad, nearest first. */
const LEG_LIMIT = 8

/** An end off the grid: the pad centre, and the cells its legs reach, each with the leg's cost. */
export interface Legs {
  at: Point
  ends: EndRef[]
}

/**
 * Legs from the pad's centre to the free cells around it, for a pad no grid cell lies on: straight tracks of the
 * net's width that keep every gap exactly (checked as laid copper, not on the grid), to at most LEG_LIMIT cells,
 * nearest first. Each costs its length in grid steps.
 */
export function padLegs(world: RouterWorld, grid: RouterGrid, rule: NetRule, pad: WorldPad, extra: readonly Obstacle[] = []): Legs {
  const at = { x: pad.x, y: pad.y }
  const reach = Math.hypot(pad.width, pad.height) / 2 + LEG_REACH
  const layers = pad.layers === "through" ? grid.layers : [pad.layers]
  const candidates: { ref: EndRef; length: number }[] = []
  grid.layers.forEach((layer, l) => {
    if (!layers.includes(layer)) return
    const map = grid.track[l] as Int32Array
    forCellsIn(grid, { minX: at.x - reach, minY: at.y - reach, maxX: at.x + reach, maxY: at.y + reach }, (cell) => {
      const centre = cellCentre(grid, cell)
      const length = Math.hypot(centre.x - at.x, centre.y - at.y)
      if (map[cell] === FREE && length <= reach) candidates.push({ ref: { layer: l, cell }, length })
    })
  })
  candidates.sort((a, b) => a.length - b.length || a.ref.layer - b.ref.layer || a.ref.cell - b.ref.cell)
  const ends: EndRef[] = []
  for (const { ref, length } of candidates) {
    if (ends.length >= LEG_LIMIT) break
    const leg: Laid = { kind: "track", layers: [grid.layers[ref.layer] as CopperLayer], shapes: [{ core: [at, cellCentre(grid, ref.cell)], radius: rule.width / 2 }] }
    if (offenders(world, rule, leg, extra).length === 0) ends.push({ ...ref, cost: Math.round((length / grid.pitch) * STEP) })
  }
  return { at, ends }
}

/** What blocks the cells on the pieces' copper, by name, in natural order, the board edge only when nothing else does. */
export function blockingNames(grid: RouterGrid, pieces: readonly CopperPiece[]): string[] {
  const names = new Set<string>()
  grid.layers.forEach((layer, l) => {
    const map = grid.track[l] as Int32Array
    for (const piece of pieces.filter((p) => p.layers.includes(layer))) {
      for (const shape of piece.shapes) {
        for (const cell of cellsOnShape(grid, shape)) if (map[cell] !== FREE) names.add(grid.blockers[map[cell] as number] as string)
      }
    }
  })
  const sorted = [...names].sort(naturalCompare)
  return sorted.length > 1 ? sorted.filter((name) => name !== BOARD_EDGE) : sorted
}
