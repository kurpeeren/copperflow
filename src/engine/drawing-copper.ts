// A drawing on copper (`<boardgraphic layer="top|bottom|inner1|inner2">`) as polygons: the outlines the pours keep clear
// of, and, for a drawing on a net, the pieces of copper that join the pads, tracks and vias of its net they touch, as a
// pour's fill does (pour/joins.ts). Pure; a drawing's pieces are worked out once per built drawing.
import type { PcbTrack, PcbVia } from "./copper.js"
import type { BoardGraphic, Point, PourLayer } from "./model.js"
import type { WorldPad } from "./pcb.js"
import { boundsOf, boxesMeet, boxHolds, counterClockwise, intersection, offset, regionHolds, regions, toPath, toPoints, union, type IntPoint, type Paths, type Region } from "./pour/clip.js"
import type { PourFill } from "./pour/fill.js"
import { pourJoins } from "./pour/joins.js"
import { shapeOutline } from "./pour/shapes.js"

const COPPER: readonly string[] = ["top", "bottom", "inner1", "inner2"]

/** A drawing on a copper layer with a net of the circuit. */
export type NetDrawing = BoardGraphic & { net: string; layer: PourLayer }

export const isNetDrawing = (graphic: BoardGraphic): graphic is NetDrawing => graphic.net !== undefined && COPPER.includes(graphic.layer)

/** The drawing's line segments (a lone point is a dot), each as a core and half its width. */
function lineCores(graphic: BoardGraphic): { core: Point[]; radius: number }[] {
  return graphic.lines.flatMap((line) =>
    (line.points.length === 1 ? [[line.points[0] as Point]] : line.points.slice(1).map((p, i) => [line.points[i] as Point, p])).map((core) => ({ core, radius: line.width / 2 })),
  )
}

/** Filled areas as rings a union reads under the non-zero rule: outlines counter-clockwise, holes clockwise. */
export function areaRings(areas: BoardGraphic["areas"]): Paths {
  return areas.flatMap((area) => [counterClockwise(toPath(area.outer)), ...area.holes.map((hole) => [...counterClockwise(toPath(hole))].reverse())])
}

/**
 * The drawing's copper grown by `grow` mm, as outlines a union reads under the non-zero rule: its areas grown whole
 * (a hole in one shrinks), its lines one segment at a time.
 */
export function drawingOutlines(graphic: BoardGraphic, grow: number): Paths {
  const rings = areaRings(graphic.areas)
  const areas = rings.length === 0 ? [] : grow > 0 ? offset(rings, grow, "round") : rings
  const lines = lineCores(graphic).map((shape) => counterClockwise(toPath(shapeOutline(shape, grow))))
  return [...areas, ...lines]
}

const piecesMemo = new WeakMap<BoardGraphic, readonly Region[]>()

/** The drawing's copper as separate pieces (each an outline with its holes), worked out once per drawing object. */
export function drawingRegions(graphic: BoardGraphic): readonly Region[] {
  const known = piecesMemo.get(graphic)
  if (known !== undefined) return known
  const made = regions(union(drawingOutlines(graphic, 0)))
  piecesMemo.set(graphic, made)
  return made
}

const regionPaths = (pieces: readonly Region[]): Paths => pieces.flatMap((piece) => [piece.outer, ...piece.holes])

/** The copper of all the drawings of one net on one layer as pieces: drawings that touch or overlap are one piece. */
function groupRegions(group: readonly NetDrawing[]): readonly Region[] {
  if (group.length === 1) return drawingRegions(group[0] as NetDrawing)
  return regions(union(group.flatMap((graphic) => regionPaths(drawingRegions(graphic)))))
}

/**
 * The drawings on nets as fills, one per net and layer (named by its first drawing): their pieces as the fill's
 * pieces, so drawings of one net that touch are one conductor. No area is reported for them.
 */
export function netDrawingFills(graphics: readonly BoardGraphic[] | undefined): PourFill[] {
  const groups = new Map<string, NetDrawing[]>()
  for (const graphic of (graphics ?? []).filter(isNetDrawing)) {
    const key = `${graphic.layer}|${graphic.net}`
    groups.set(key, [...(groups.get(key) ?? []), graphic])
  }
  return [...groups.values()].map((group) => {
    const first = group[0] as NetDrawing
    const polygons = groupRegions(group).map((region) => ({ outer: toPoints(region.outer), holes: region.holes.map(toPoints) }))
    return { id: first.id, net: first.net, layer: first.layer, polygons, area: 0 }
  })
}

const piecesOf = (fills: readonly PourFill[]) =>
  fills.flatMap((fill) =>
    fill.polygons.map((polygon) => {
      const region: Region = { outer: toPath(polygon.outer), holes: polygon.holes.map(toPath) }
      return { fill, region, paths: [region.outer, ...region.holes], box: boundsOf([region.outer]) }
    }),
  )

type Piece = ReturnType<typeof piecesOf>[number]
const holdsPoint = (piece: Piece, p: IntPoint) => boxHolds(piece.box, p) && regionHolds(piece.region, p)

/**
 * The drawing pieces among `candidates` that the fill piece's copper meets: a corner of one inside the fill decides it
 * at once; the rest are intersected with the fill in one clip, each common part pointing back at the piece holding it.
 */
function metBy(piece: Piece, candidates: readonly { other: Piece; j: number }[]): number[] {
  const inside = candidates.filter(({ other }) => other.region.outer.some((p) => holdsPoint(piece, p)))
  const rest = candidates.filter((one) => !inside.includes(one))
  if (rest.length === 0) return inside.map(({ j }) => j)
  const common = regions(intersection(piece.paths, rest.flatMap(({ other }) => other.paths)))
  const hit = rest.filter(({ other }) => common.some((part) => part.outer.some((p) => holdsPoint(other, p))))
  return [...inside, ...hit].map(({ j }) => j).sort((a, b) => a - b)
}

/**
 * For each piece of `fills` (in pourJoins' order), the pieces of the drawings on its net and layer that its copper
 * meets: a pour's fill and a drawing of its net touching are one conductor.
 */
export function touchingDrawings(fills: readonly PourFill[], drawings: readonly PourFill[]): number[][] {
  const others = piecesOf(drawings)
  return piecesOf(fills).map((piece) => {
    const candidates = others.flatMap((other, j) => (other.fill.net === piece.fill.net && other.fill.layer === piece.fill.layer && boxesMeet(piece.box, other.box) ? [{ other, j }] : []))
    return candidates.length === 0 ? [] : metBy(piece, candidates)
  })
}

/**
 * The groups of pad, track and via ids that one conductor joins through drawings on nets and through pours: each
 * drawing piece's own copper, and each pour piece's, with the copper of the drawing pieces it touches added.
 */
export function joinsWithDrawings(pours: readonly PourFill[], drawings: readonly PourFill[], pads: readonly WorldPad[], tracks: readonly PcbTrack[], vias: readonly PcbVia[]): string[][] {
  const drawn = pourJoins(drawings, pads, tracks, vias)
  const poured = pourJoins(pours, pads, tracks, vias)
  if (drawings.length === 0) return poured
  const touching = touchingDrawings(pours, drawings)
  return [...drawn, ...poured.map((ids, i) => [...ids, ...(touching[i] ?? []).flatMap((j) => drawn[j] ?? [])])]
}
