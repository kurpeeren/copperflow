import { copperTouches, padsUnder } from "../copper.js"
import { copperPieces, padPieces, type CopperPiece } from "../checks/copper-pieces.js"
import type { PcbLayout } from "../pcb.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import type { CellRef } from "./astar.js"
import { cellsOnShape, FREE, type RouterGrid } from "./grid.js"

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
