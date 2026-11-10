import { viaSpan } from "../copper.js"
import type { Hole, Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout, PourFill } from "../pcb.js"
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
 * copper of its net on its layer joins nothing: a `pour-floating` warning.
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

const boxesMeet = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY

// ---- floating pours ----

/** A pour with no pad, track or via of its net on its layer. */
function floating(layout: PcbLayout, fill: PourFill): Violation | undefined {
  const pads = layout.parts.flatMap((part) => part.pads).some((pad) => pad.net === fill.net && (pad.layers === "through" || pad.layers === fill.layer))
  const tracks = layout.tracks.some((track) => track.missingLayer === undefined && track.net === fill.net && track.layer === fill.layer)
  const vias = layout.vias.some((via) => via.missingLayer === undefined && via.net === fill.net && viaSpan(via).has(fill.layer))
  if (pads || tracks || vias) return undefined
  const message = `${fill.id} (${fill.net}, ${fill.layer}) touches no ${fill.net} copper on its layer, so it joins nothing`
  return violation("pour-floating", "warning", message, [fill.id], "pcb", fill.polygons[0]?.outer[0])
}

/** Every check on the pours and the holes, sorted by id. `classOf` gives a net's class. */
export function pourChecks(layout: PcbLayout, rules: Rules, classOf: ClassOf): Violation[] {
  if (layout.pours.length === 0 && layout.holes.length === 0) return []
  const pours = layout.pours.map((fill) => measured(fill, classOf))
  const pieces = [...padPieces(layout, classOf), ...copperPieces(layout, classOf)]
  const found = [...clearanceChecks(pours, pieces, rules), ...holeChecks(layout, pours, pieces, rules), ...layout.pours.flatMap((fill) => floating(layout, fill) ?? [])]
  return found.sort((a, b) => naturalCompare(a.id, b.id))
}
