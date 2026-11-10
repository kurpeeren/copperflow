import type { CopperPour, Point, PourLayer } from "../model.js"
import {
  difference,
  intersection,
  offset,
  pathArea,
  regionArea,
  regions,
  toPath,
  toPoints,
  union,
  UNITS_PER_MM,
  type Path,
  type Paths,
  type Region,
} from "./clip.js"
import { connectedPieces } from "./islands.js"
import { layerCopper, type EarlierFill, type PourInputs } from "./obstacles.js"

/** A piece of a pour's copper: its outline (counter-clockwise, y up) and its holes (clockwise), in mm. */
export interface PourPolygon {
  outer: Point[]
  holes: Point[][]
}

/** A pour's computed copper: the pieces on its layer and their area in mm². Never written to a file. */
export interface PourFill {
  id: string
  net: string
  layer: PourLayer
  polygons: PourPolygon[]
  area: number
}

export type { PourInputs }

/** A piece or hole smaller than this, in µm² (0.0001 mm²), is a crumb of rounding and is dropped. */
const MIN_PIECE_AREA = 100
const AREA_DIGITS = 1e6

/** The board's outline shrunk by the board-edge clearance, and cut to the pour's own outline when it has one. */
function pourRegion(pour: CopperPour, inputs: PourInputs): Paths {
  const board = offset(union([toPath(inputs.board.outline)]), -inputs.rules.fabrication.boardEdgeClearance, "miter")
  return pour.outline ? intersection(board, union([toPath(pour.outline)])) : board
}

/**
 * A morphological open: shrink by half `width`, grow back. Copper narrower than `width` vanishes; the rest keeps its
 * square corners (miter), and is cut back to the area it came from, so the open never adds copper.
 */
function open(paths: Paths, width: number): Paths {
  if (paths.length === 0) return []
  return intersection(offset(offset(paths, -width / 2, "miter"), width / 2, "miter"), paths)
}

/**
 * The path when it has size; a crumb of rounding is dropped. Points are not merged or moved: clipper's output is
 * already free of repeats, and moving a point could bring the copper closer to what it keeps clear of.
 */
function tidy(path: Path): Path | undefined {
  return path.length >= 3 && Math.abs(pathArea(path)) >= MIN_PIECE_AREA ? path : undefined
}

/** The path turned to the wanted direction and started at its lowest-left point, so equal shapes print equally. */
function canonical(path: Path, counterClockwise: boolean): Path {
  const turned = pathArea(path) > 0 === counterClockwise ? path : [...path].reverse()
  const start = turned.reduce((best, p, i) => {
    const q = turned[best] as Path[number]
    return p.X < q.X || (p.X === q.X && p.Y < q.Y) ? i : best
  }, 0)
  return [...turned.slice(start), ...turned.slice(0, start)]
}

const firstPoint = (path: Path) => path[0] ?? { X: 0, Y: 0 }
const byFirstPoint = (a: Path, b: Path) => firstPoint(a).X - firstPoint(b).X || firstPoint(a).Y - firstPoint(b).Y

function tidyRegions(pieces: readonly Region[]): Region[] {
  return pieces.flatMap((piece) => {
    const outer = tidy(piece.outer)
    if (outer === undefined) return []
    const holes = piece.holes.map(tidy).filter((hole): hole is Path => hole !== undefined).map((hole) => canonical(hole, false))
    return [{ outer: canonical(outer, true), holes: holes.sort(byFirstPoint) }]
  })
}

/** The copper of one pour: the region less the obstacles and relief gaps, opened, with spokes, without islands. */
function fillOne(pour: CopperPour, inputs: PourInputs, earlier: readonly EarlierFill[]): Region[] {
  const copper = layerCopper(pour, inputs, earlier)
  const allowed = difference(pourRegion(pour, inputs), copper.obstacles)
  const cut = copper.cuts.length > 0 ? difference(allowed, copper.cuts) : allowed
  const opened = open(cut, pour.minWidth)
  const spokes = copper.spokes.length > 0 ? intersection(copper.spokes, allowed) : []
  const all = regions([...opened, ...spokes])
  // With no copper of its net on the layer yet there is nothing to join: the pour keeps its whole fill.
  const pieces = copper.anchors.length > 0 ? connectedPieces(all, copper.anchors) : all
  return tidyRegions(pieces).sort((a, b) => byFirstPoint(a.outer, b.outer))
}

const regionPaths = (pieces: readonly Region[]): Paths => pieces.flatMap((piece) => [piece.outer, ...piece.holes])

function asFill(pour: CopperPour, pieces: readonly Region[]): PourFill {
  const squareUnits = pieces.reduce((sum, piece) => sum + regionArea(piece), 0)
  const area = Math.round((squareUnits / (UNITS_PER_MM * UNITS_PER_MM)) * AREA_DIGITS) / AREA_DIGITS
  const polygons = pieces.map((piece) => ({ outer: toPoints(piece.outer), holes: piece.holes.map(toPoints) }))
  return { id: pour.id, net: pour.net, layer: pour.layer, polygons, area }
}

/**
 * Fills every pour of the board, deterministically: higher priority first (equal ones in source order), each keeping
 * clear of the fills before it on its layer. The result is in the board's pour order. A board without a usable
 * outline fills nothing.
 */
export function fillPours(inputs: PourInputs): PourFill[] {
  const pours = inputs.board.pours ?? []
  if (inputs.board.outline.length < 3) return pours.map((pour) => asFill(pour, []))
  const order = pours.map((pour, index) => ({ pour, index })).sort((a, b) => b.pour.priority - a.pour.priority || a.index - b.index)
  const earlier: EarlierFill[] = []
  const filled = new Map<string, PourFill>()
  for (const { pour } of order) {
    const pieces = fillOne(pour, inputs, earlier)
    earlier.push({ net: pour.net, layer: pour.layer, paths: regionPaths(pieces) })
    filled.set(pour.id, asFill(pour, pieces))
  }
  return pours.map((pour) => filled.get(pour.id) as PourFill)
}
