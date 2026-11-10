import { usableOutline } from "../board.js"
import { counterClockwise, difference, intersection, offset, pathArea, toPath, toPoints, union, type Paths } from "../pour/clip.js"
import { shapeOutline } from "../pour/shapes.js"
import type { Hole, Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout, PourFill, WorldPad } from "../pcb.js"
import { pourJoins } from "../pour/joins.js"
import { requiredClearance } from "../rules/classes.js"
import type { Rules } from "../rules/schema.js"
import { ruleText } from "./copper-clearance.js"
import { copperPieces, padPieces, type ClassOf, type CopperPiece } from "./copper-pieces.js"
import { copperViolation, gap, mm } from "./copper-violation.js"
import { bounds, closestPoints, pointInPolygon, shapeDistance, type Shape } from "./geometry.js"
import { GridIndex, type Box } from "./grid-index.js"
import { breaksMinimum } from "./limits.js"
import { violation, type Violation } from "./violation.js"

/**
 * The checks on the pours' fills and the board's holes. A fill is copper: it keeps the clearance to every other net's
 * pads, tracks, vias and fills on its layer (the fill is built that way; this is the safety net), and like all copper it
 * keeps the board-edge clearance from a non-plated hole (`copper-hole`, for pads, tracks and vias too). A pour with no
 * copper warns (`pour-empty`), as does one joining no pad of its net (`pour-floating`) or fewer than half (`pour-sparse`). A fill also keeps the board-edge clearance
 * and out of keepouts on its layer, checked with a 2 µm tolerance as a safety net (`copper-edge`, `copper-keepout`).
 * A hole not wholly inside the board, less the board-edge clearance, is an error (`hole-off-board`).
 */

/** The grid cell for a fill's edges, in mm. */
const EDGE_CELL = 2

/** A fill ready to measure: its rings, its edges in a grid, its class. */
interface Measured {
  fill: PourFill
  className: string
  rings: Point[][]
  edges: GridIndex<Shape>
}

/** How near a shape comes to a fill: 0 or less when they touch or overlap; where to point at it. */
interface Nearness {
  distance: number
  at: Point
}

const grow = (box: Box, by: number): Box => ({ minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by })
const midpoint = ([a, b]: [Point, Point]): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

function measured(fill: PourFill, classOf: ClassOf): Measured {
  const rings = fill.polygons.flatMap((polygon) => [polygon.outer, ...polygon.holes])
  const edges = new GridIndex<Shape>(EDGE_CELL)
  for (const ring of rings) {
    ring.forEach((p, i) => {
      const edge: Shape = { core: [p, ring[(i + 1) % ring.length] as Point], radius: 0 }
      edges.insert(edge, bounds(edge))
    })
  }
  return { fill, className: classOf(fill.net), rings, edges }
}

/** Inside a piece of the fill: inside its outline and in none of its holes. */
function inFill(fill: PourFill, p: Point): boolean {
  return fill.polygons.some((polygon) => pointInPolygon(p, polygon.outer) && !polygon.holes.some((hole) => pointInPolygon(p, hole)))
}

/** How near the shape comes to the fill, looking `reach` around it; undefined when nothing of the fill is that near. */
function nearness(pour: Measured, shape: Shape, reach: number): Nearness | undefined {
  const inside = shape.core.find((p) => inFill(pour.fill, p))
  return inside !== undefined ? { distance: -shape.radius, at: inside } : edgeNearness(pour, shape, reach)
}

/** How near the shape comes to the fill's edges, looking `reach` around it. */
function edgeNearness(pour: Measured, shape: Shape, reach: number): Nearness | undefined {
  let best: Nearness | undefined
  for (const edge of pour.edges.query(grow(bounds(shape), reach))) {
    const distance = shapeDistance(shape, edge)
    if (best === undefined || distance < best.distance) best = { distance, at: midpoint(closestPoints(shape, edge)) }
  }
  return best
}

/** How near two fills come: an edge of one against the other, or one inside the other. */
function fillsNearness(a: Measured, b: Measured, reach: number): Nearness | undefined {
  const inside = [...b.rings.map((ring) => [ring[0], a] as const), ...a.rings.map((ring) => [ring[0], b] as const)].find(
    ([p, other]) => p !== undefined && inFill(other.fill, p),
  )
  if (inside?.[0] !== undefined) return { distance: 0, at: inside[0] }
  let best: Nearness | undefined
  for (const ring of b.rings) {
    ring.forEach((p, i) => {
      const found = edgeNearness(a, { core: [p, ring[(i + 1) % ring.length] as Point], radius: 0 }, reach)
      if (found !== undefined && (best === undefined || found.distance < best.distance)) best = found
    })
  }
  return best
}

function clearanceViolation(rules: Rules, [a, b]: [{ id: string; className: string }, { id: string; className: string }], near: Nearness | undefined): Violation | undefined {
  const required = requiredClearance(rules, a.className, b.className)
  if (near === undefined || !breaksMinimum(near.distance, required)) return undefined
  const [first, second] = [a, b].sort((x, y) => naturalCompare(x.id, y.id)) as [typeof a, typeof b]
  const message = `${first.id} and ${second.id} are ${gap(near.distance)}; ${ruleText(rules, first.className, second.className, required)}`
  return copperViolation("copper-clearance", message, [first.id, second.id], [first.id, second.id], near.at)
}

/** The nearest of the piece's shapes to the fill. */
function pieceNearness(pour: Measured, piece: CopperPiece, reach: number): Nearness | undefined {
  return piece.shapes.map((shape) => nearness(pour, shape, reach)).reduce<Nearness | undefined>((best, next) => (next !== undefined && (best === undefined || next.distance < best.distance) ? next : best), undefined)
}

function clearanceChecks(pours: readonly Measured[], pieces: readonly CopperPiece[], rules: Rules): Violation[] {
  const reachOf = (a: string, b: string) => requiredClearance(rules, a, b)
  const found: Violation[] = []
  pours.forEach((pour, i) => {
    const self = { id: pour.fill.id, className: pour.className }
    for (const piece of pieces) {
      if (piece.net === pour.fill.net || !piece.layers.includes(pour.fill.layer)) continue
      const near = pieceNearness(pour, piece, reachOf(pour.className, piece.className))
      found.push(...[clearanceViolation(rules, [self, { id: piece.id, className: piece.className }], near)].filter((v): v is Violation => v !== undefined))
    }
    for (const other of pours.slice(i + 1)) {
      if (other.fill.net === pour.fill.net || other.fill.layer !== pour.fill.layer) continue
      const near = fillsNearness(pour, other, reachOf(pour.className, other.className))
      found.push(...[clearanceViolation(rules, [self, { id: other.fill.id, className: other.className }], near)].filter((v): v is Violation => v !== undefined))
    }
  })
  return found
}

// ---- holes ----

function holeViolation(hole: Hole, id: string, near: Nearness | undefined, minimum: number): Violation | undefined {
  if (near === undefined || !breaksMinimum(near.distance, minimum)) return undefined
  const where = near.distance > 0 ? `is ${mm(near.distance)} mm from` : "touches or overlaps"
  const key = [hole.id, id].sort(naturalCompare)
  return copperViolation("copper-hole", `${id} ${where} ${hole.id}; copper keeps ${mm(minimum)} mm from a hole`, key, key, near.at)
}

/** Every piece of copper, fills included, nearer a non-plated hole than the board-edge clearance. */
function holeChecks(layout: PcbLayout, pours: readonly Measured[], pieces: readonly CopperPiece[], rules: Rules): Violation[] {
  const minimum = rules.fabrication.boardEdgeClearance
  return layout.holes.flatMap((hole) => {
    const disc: Shape = { core: [{ x: hole.x, y: hole.y }], radius: hole.diameter / 2 }
    const reach = grow(bounds(disc), minimum)
    const near = (shape: Shape): Nearness => ({ distance: shapeDistance(shape, disc), at: midpoint(closestPoints(shape, disc)) })
    const ofPieces = pieces.flatMap((piece) => {
      const close = piece.shapes.filter((shape) => boxesMeet(bounds(shape), reach)).map(near)
      const best = close.reduce<Nearness | undefined>((a, b) => (a === undefined || b.distance < a.distance ? b : a), undefined)
      return holeViolation(hole, piece.id, best, minimum) ?? []
    })
    const ofPours = pours.flatMap((pour) => holeViolation(hole, pour.fill.id, nearness(pour, disc, minimum), minimum) ?? [])
    return [...ofPieces, ...ofPours]
  })
}

/** How much of a hole may lie past the shrunk outline before it is reported, in square micrometres: rounding only. */
const OFF_BOARD_AREA = 1

/**
 * A hole whose circle is not wholly inside the board's outline shrunk by the board-edge clearance: off the board or
 * across its edge. Checked on the built positions, so a hole in a group or a sub-sheet instance is covered too.
 */
function holesOffBoard(layout: PcbLayout, rules: Rules): Violation[] {
  const board = layout.board
  if (board === undefined || !usableOutline(board)) return []
  const edge = rules.fabrication.boardEdgeClearance
  const allowed = offset(union([counterClockwise(toPath(board.outline))]), -edge, "miter")
  return layout.holes.flatMap((hole) => {
    const disc = [counterClockwise(toPath(shapeOutline({ core: [{ x: hole.x, y: hole.y }], radius: hole.diameter / 2 })))]
    const outside = difference(disc, allowed).reduce((sum, path) => sum + Math.abs(pathArea(path)), 0)
    if (outside <= OFF_BOARD_AREA) return []
    const message = `${hole.id} at (${mm6(hole.x)}, ${mm6(hole.y)}), ${mm6(hole.diameter)} mm is not inside the board: a hole keeps ${mm6(edge)} mm from the board edge`
    return [violation("hole-off-board", "error", message, [hole.id], "pcb", { x: hole.x, y: hole.y })]
  })
}

const mm6 = (n: number) => String(Math.round(n * 1e6) / 1e6)

const boxesMeet = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY

// ---- the board edge and keepouts ----

/**
 * How far a fill may reach past the board-edge clearance or into a keepout before it is reported, in mm: 2 µm, below
 * the fill's own 3 µm margin and above its 1 µm rounding, so the safety net never fires on a fill built as designed.
 */
const FILL_TOLERANCE = 0.002

const fillPaths = (fill: PourFill): Paths => fill.polygons.flatMap((polygon) => [toPath(polygon.outer), ...polygon.holes.map(toPath)])
const firstPoint = (paths: Paths): Point | undefined => toPoints(paths[0] ?? [])[0]

/** A fill reaching nearer the board edge than its clearance (less the tolerance), or off the board. */
function fillEdge(layout: PcbLayout, fill: PourFill, rules: Rules): Violation | undefined {
  const board = layout.board
  if (board === undefined || !usableOutline(board)) return undefined
  const minimum = rules.fabrication.boardEdgeClearance
  const allowed = offset(union([counterClockwise(toPath(board.outline))]), -(minimum - FILL_TOLERANCE), "miter")
  const at = firstPoint(difference(fillPaths(fill), allowed))
  if (at === undefined) return undefined
  return copperViolation("copper-edge", `${fill.id} comes nearer the board edge than ${mm(minimum)} mm`, [fill.id], [fill.id], at)
}

/** A fill reaching into a keepout on its layer by more than the tolerance. */
function fillKeepouts(layout: PcbLayout, fill: PourFill): Violation[] {
  const keepouts = (layout.board?.keepouts ?? []).filter((keepout) => keepout.outline.length >= 3 && (keepout.layers === "all" || keepout.layers === fill.layer))
  return keepouts.flatMap((keepout) => {
    const inner = offset(union([counterClockwise(toPath(keepout.outline))]), -FILL_TOLERANCE, "miter")
    const at = firstPoint(intersection(fillPaths(fill), inner))
    if (at === undefined) return []
    return [copperViolation("copper-keepout", `${fill.id} lies inside ${keepout.id}`, [fill.id, keepout.id], [fill.id, keepout.id], at)]
  })
}

// ---- pours that join little or nothing ----

/** The pads of the fills' net that their copper touches, each once. */
function padsJoined(layout: PcbLayout, fills: readonly PourFill[], pads: readonly WorldPad[]): Set<string> {
  const padIds = new Set(pads.map((pad) => pad.id))
  return new Set(pourJoins(fills, pads, layout.tracks, layout.vias).flat().filter((id) => padIds.has(id)))
}

/** The pours on the fill's layer of another net that filled before it (higher priority, or equal and earlier) and got copper. */
function takenBy(layout: PcbLayout, fill: PourFill): string[] {
  const pours = layout.board?.pours ?? []
  const index = pours.findIndex((pour) => pour.id === fill.id)
  const self = pours[index]
  if (self === undefined) return []
  return pours
    .filter((pour, i) => pour.layer === self.layer && pour.net !== self.net && (pour.priority > self.priority || (pour.priority === self.priority && i < index)))
    .filter((pour) => (layout.pours.find((one) => one.id === pour.id)?.area ?? 0) > 0)
    .map((pour) => pour.id)
}

/**
 * A pour with no copper (`pour-empty`, naming the pours that took its area); one that joins no pad of its net
 * (`pour-floating`); one that joins fewer than half its net's pads, with its net's other pours not making up the half
 * (`pour-sparse`): a pour on the far side of a board whose parts sit on top joins only their through pads.
 */
function pourUse(layout: PcbLayout, fill: PourFill, net: string): Violation | undefined {
  const at = fill.polygons[0]?.outer[0]
  if (fill.polygons.length === 0) {
    if (layout.board === undefined || !usableOutline(layout.board)) return undefined
    const took = takenBy(layout, fill)
    const why = took.length > 0 ? `${took.join(" and ")} took its area` : `what is left of its area once other copper, keepouts and holes are kept clear of touches no ${net} copper`
    return violation("pour-empty", "warning", `${fill.id} has no copper: ${why}`, [fill.id], "pcb")
  }
  const pads = layout.parts.flatMap((part) => part.pads).filter((pad) => pad.net === fill.net)
  const joined = padsJoined(layout, [fill], pads).size
  if (joined === 0) return violation("pour-floating", "warning", `${fill.id} joins no pad of ${net}`, [fill.id], "pcb", at)
  if (joined * 2 >= pads.length) return undefined
  // A pour on each side together joining most of the net's pads is the usual two-layer board: no warning.
  const together = layout.pours.filter((one) => one.net === fill.net)
  if (together.length > 1 && padsJoined(layout, together, pads).size * 2 >= pads.length) return undefined
  const message = `${fill.id} joins only ${joined} of ${pads.length} ${net} pads; a pour joins the pads on its own layer and through pads, so put one on the layer the parts sit on`
  return violation("pour-sparse", "warning", message, [fill.id], "pcb", at)
}

/** Every check on the pours and the holes, sorted by id. `classOf` gives a net's class. */
export function pourChecks(layout: PcbLayout, rules: Rules, classOf: ClassOf, netName: (net: string) => string = (net) => net): Violation[] {
  if (layout.pours.length === 0 && layout.holes.length === 0) return []
  const pours = layout.pours.map((fill) => measured(fill, classOf))
  const pieces = [...padPieces(layout, classOf), ...copperPieces(layout, classOf)]
  const found = [
    ...clearanceChecks(pours, pieces, rules),
    ...holeChecks(layout, pours, pieces, rules),
    ...holesOffBoard(layout, rules),
    ...layout.pours.flatMap((fill) => [pourUse(layout, fill, netName(fill.net)), fillEdge(layout, fill, rules), ...fillKeepouts(layout, fill)].filter((v): v is Violation => v !== undefined)),
  ]
  return found.sort((a, b) => naturalCompare(a.id, b.id))
}
