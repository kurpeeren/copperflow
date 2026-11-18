// Drawings on copper (`<boardgraphic layer="top|bottom|inner1|inner2">`) against what a board house can etch and what a
// net needs: a filled part thinner than the minimum track width (`drawing-width`), and a drawing on a net whose copper
// touches nothing of that net (`drawing-floating`, an island). Their clearance, edge, keepout and hole checks are the
// copper checks'. Pure.
import { isCopperGraphic, placedShape } from "../board-graphic.js"
import { areaRings, drawingRegions, isNetDrawing, netDrawingFills, touchingDrawings, type NetDrawing } from "../drawing-copper.js"
import type { BoardGraphic, Point } from "../model.js"
import type { PcbLayout } from "../pcb.js"
import { boundsOf, boxHolds, difference, regionArea, regionHolds, regions, toPath, toPoints, union, UNITS_PER_MM, type IntPoint, type Region } from "../pour/clip.js"
import { open } from "../pour/fill.js"
import { pourJoins } from "../pour/joins.js"
import { violation, type Violation } from "./violation.js"

/**
 * A lost piece no larger than this share of the minimum width squared is a sliver: the corner a round grow cannot
 * rebuild (a square corner loses about 0.05 of it), not a part too thin to etch.
 */
const SLIVER_SHARE = 0.25

const mm = (value: number) => value.toFixed(3)
const named = (graphic: BoardGraphic) => `${graphic.id} (${graphic.file})`
const netWords = (net: string) => net.replace(/^net[.:]/, "")

/** The smallest and largest of many numbers, by a loop (spreading a long ring into Math.min overflows the stack). */
const lowest = (values: readonly number[]) => values.reduce((a, b) => Math.min(a, b), Infinity)
const highest = (values: readonly number[]) => values.reduce((a, b) => Math.max(a, b), -Infinity)

/**
 * A point in the piece: the middle of its box or the mean of its corners when the piece holds it, else the first
 * midpoint of two opposite corners it holds, else its first corner.
 */
function pointIn(piece: Region): Point {
  const corners = toPoints(piece.outer)
  const [xs, ys] = [corners.map((p) => p.x), corners.map((p) => p.y)]
  const middle = { x: (lowest(xs) + highest(xs)) / 2, y: (lowest(ys) + highest(ys)) / 2 }
  const mean = { x: xs.reduce((sum, x) => sum + x, 0) / xs.length, y: ys.reduce((sum, y) => sum + y, 0) / ys.length }
  const half = Math.floor(corners.length / 2)
  const across = corners.map((p, i) => {
    const q = corners[(i + half) % corners.length] as Point
    return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }
  })
  const held = [middle, mean, ...across].find((p) => regionHolds(piece, toPath([p])[0] as Region["outer"][number]))
  return held ?? (corners[0] as Point)
}

/** The point in the largest part of the areas thinner than `minimum`, or undefined when no part is. */
function thinPoint(areas: BoardGraphic["areas"], minimum: number): Point | undefined {
  if (areas.length === 0 || minimum <= 0) return undefined
  const copper = union(areaRings(areas))
  const limit = SLIVER_SHARE * minimum * minimum * UNITS_PER_MM * UNITS_PER_MM
  const lost = regions(difference(copper, open(copper, minimum))).filter((piece) => regionArea(piece) > limit)
  const largest = lost.sort((a, b) => regionArea(b) - regionArea(a))[0]
  return largest === undefined ? undefined : pointIn(largest)
}

/** Thin points per placed shape and minimum, in the shape's own frame: every build of an unchanged drawing shares them. */
const thinMemo = new WeakMap<object, Map<number, Point | null>>()

/** The point of the drawing's thinnest lost part on the board, worked out once per shape and minimum. */
function thinPartOf(graphic: BoardGraphic, minimum: number): Point | undefined {
  const placed = placedShape(graphic)
  if (placed === undefined) return thinPoint(graphic.areas, minimum)
  const known = thinMemo.get(placed.shape) ?? new Map<number, Point | null>()
  thinMemo.set(placed.shape, known)
  if (!known.has(minimum)) known.set(minimum, thinPoint(placed.shape.areas, minimum) ?? null)
  const local = known.get(minimum)
  return local === null || local === undefined ? undefined : { x: local.x + placed.at.x, y: local.y + placed.at.y }
}

/** "has a filled part thinner than … near (x, y); …": the finding without the drawing's name, for one message or two. */
export function thinPartText(minimum: number, at: Point): string {
  return `has a filled part thinner than the fabrication minimum track width of ${mm(minimum)} mm near (${mm(at.x)}, ${mm(at.y)}); the board house may not etch it: make the drawing larger or that part wider in the file`
}

/** Each drawing on copper with a filled part thinner than `minimum`, at a point in that part. */
export function thinPartChecks(graphics: readonly BoardGraphic[], minimum: number): Violation[] {
  return graphics.filter(isCopperGraphic).flatMap((graphic) => {
    const at = thinPartOf(graphic, minimum)
    if (at === undefined) return []
    const message = `Drawing on copper ${named(graphic)} ${thinPartText(minimum, at)}`
    return [violation("drawing-width", "warning", message, [graphic.id], "pcb", at)]
  })
}

/**
 * For each drawing on a net, how many of its pieces touch no copper of the net: no pad, track or via, no pour of it,
 * and no other drawing of it that does (drawings of one net that touch are one piece, netDrawingFills).
 */
function lonePieces(layout: PcbLayout, drawings: readonly NetDrawing[]): number[] {
  const fills = netDrawingFills(drawings)
  const pads = layout.parts.flatMap((part) => part.pads)
  const own = pourJoins(fills, pads, layout.tracks, layout.vias)
  const byPour = new Set(touchingDrawings(layout.pours, fills).flat())
  const merged = fills.flatMap((fill) =>
    fill.polygons.map((polygon) => {
      const region = { outer: toPath(polygon.outer), holes: polygon.holes.map(toPath) }
      return { fill, region, box: boundsOf([region.outer]) }
    }),
  )
  const joined = merged.map((_, k) => (own[k] ?? []).length > 0 || byPour.has(k))
  const holding = (graphic: NetDrawing, corner: IntPoint) =>
    merged.findIndex((one) => one.fill.net === graphic.net && one.fill.layer === graphic.layer && boxHolds(one.box, corner) && regionHolds(one.region, corner))
  return drawings.map((graphic) => drawingRegions(graphic).filter((piece) => piece.outer[0] === undefined || !(joined[holding(graphic, piece.outer[0])] ?? false)).length)
}

/** Each drawing on a net with pieces that touch nothing of its net: islands, as a floating pour is. */
export function islandChecks(layout: PcbLayout): Violation[] {
  const drawings = (layout.graphics ?? []).filter(isNetDrawing)
  if (drawings.length === 0) return []
  const lone = lonePieces(layout, drawings)
  return drawings.flatMap((graphic, i) => {
    const count = lone[i] ?? 0
    if (count === 0) return []
    const pieces = drawingRegions(graphic).length
    const net = netWords(graphic.net)
    const what = count === pieces ? `touches no copper of ${net}: it is an island, joined to nothing` : `has ${count} of its ${pieces} pieces touching no copper of ${net}: they are islands`
    const message = `Drawing on copper ${named(graphic)} on ${net} ${what}; move it onto ${net}'s pads or tracks, or leave net out`
    return [violation("drawing-floating", "warning", message, [graphic.id], "pcb", { x: graphic.x, y: graphic.y })]
  })
}
