import type { Keepout, Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout, PlacedFootprint, WorldPad } from "../pcb.js"
import type { Rules } from "../rules/schema.js"
import { bounds, padShape, pointInPolygon, polygonsOverlap, shapeDistance, shapeToSegmentDistance, type Shape } from "./geometry.js"
import { GridIndex, type Box } from "./grid-index.js"
import { breaksMinimum, LENGTH_TOLERANCE, usableOutline } from "./limits.js"
import { violation, type Violation } from "./violation.js"

/**
 * Placement checks on whole parts: courtyards against each other and the board outline, pads and
 * courtyards against keepouts, silkscreen against exposed pads, and the board-level notes about
 * parts without a position, connections not routed yet and a missing outline.
 */

/** Side of a cell in the courtyard index, in mm: about the size of a small part. */
const CELL = 5

const isPolygon = (points: readonly Point[]) => points.length >= 3
const mm = (value: number) => value.toFixed(3)
const at = (part: PlacedFootprint): Point => ({ x: part.x, y: part.y })
const byComponent = (a: PlacedFootprint, b: PlacedFootprint) => naturalCompare(a.component, b.component)
const nextPoint = (points: readonly Point[], i: number): Point => points[(i + 1) % points.length] as Point

function boxOf(points: readonly Point[]): Box {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

function segments(points: readonly Point[], closed: boolean): [Point, Point][] {
  const count = closed ? points.length : points.length - 1
  return Array.from({ length: Math.max(count, 0) }, (_, i): [Point, Point] => [points[i] as Point, nextPoint(points, i)])
}

// ---- courtyards against each other ----

/** Each pair once, among parts on the same side. */
function courtyardOverlaps(parts: readonly PlacedFootprint[]): Violation[] {
  const placed = parts.filter((p) => isPolygon(p.courtyard)).sort(byComponent)
  const index = new GridIndex<number>(CELL)
  placed.forEach((p, i) => index.insert(i, boxOf(p.courtyard)))
  return placed.flatMap((a, i) =>
    index
      .query(boxOf(a.courtyard))
      .filter((j) => j > i)
      .flatMap((j) => {
        const b = placed[j] as PlacedFootprint
        if (a.side !== b.side || !polygonsOverlap(a.courtyard, b.courtyard)) return []
        const message = `The courtyards of ${a.component} and ${b.component} overlap`
        return [violation("courtyard-overlap", "error", message, [a.component, b.component], "pcb", { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })]
      }),
  )
}

// ---- courtyard inside the outline ----

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
const sign = (value: number) => (Math.abs(value) <= LENGTH_TOLERANCE ? 0 : Math.sign(value))

/** True when the segments cross at a point inside both. Touching and running along each other do not count. */
function segmentsCross(p: Point, q: Point, r: Point, s: Point): boolean {
  const [d1, d2, d3, d4] = [sign(cross(p, q, r)), sign(cross(p, q, s)), sign(cross(r, s, p)), sign(cross(r, s, q))]
  return d1 * d2 < 0 && d3 * d4 < 0
}

function onOutline(p: Point, outline: readonly Point[]): boolean {
  const here: Shape = { core: [p], radius: 0 }
  return segments(outline, true).some(([a, b]) => shapeToSegmentDistance(here, a, b) <= LENGTH_TOLERANCE)
}

/**
 * Inside means every corner is inside or on the outline and no outline edge crosses a courtyard edge,
 * so a courtyard cannot poke out between two corners of a concave outline.
 */
function insideOutline(courtyard: readonly Point[], outline: readonly Point[]): boolean {
  if (!courtyard.every((p) => pointInPolygon(p, outline) || onOutline(p, outline))) return false
  const edges = segments(outline, true)
  return !segments(courtyard, true).some(([p, q]) => edges.some(([r, s]) => segmentsCross(p, q, r, s)))
}

function outsideBoard(parts: readonly PlacedFootprint[], outline: readonly Point[]): Violation[] {
  return parts
    .filter((p) => isPolygon(p.courtyard) && !insideOutline(p.courtyard, outline))
    .map((p) => violation("outside-board", "warning", `${p.component} is not inside the board outline`, [p.component], "pcb", at(p)))
}

// ---- keepouts ----

const onKeepoutLayer = (layers: WorldPad["layers"] | PlacedFootprint["side"], keepout: Keepout) =>
  keepout.layers === "all" || layers === "through" || layers === keepout.layers

/** A positive-area overlap: touching the edge of a keepout is allowed. */
function overlapsKeepout(shape: Shape, keepout: Keepout): boolean {
  if (shape.radius === 0 && isPolygon(shape.core)) return polygonsOverlap(shape.core, keepout.outline)
  return shapeDistance(shape, { core: keepout.outline, radius: 0 }) < 0 || shape.core.some((p) => pointInPolygon(p, keepout.outline))
}

/** Where the part meets the keepout: a pad first, otherwise the courtyard. */
function keepoutHit(part: PlacedFootprint, keepout: Keepout): Point | undefined {
  const pad = part.pads.find((candidate) => {
    const shape = padShape(candidate)
    return shape !== undefined && onKeepoutLayer(candidate.layers, keepout) && overlapsKeepout(shape, keepout)
  })
  if (pad !== undefined) return { x: pad.x, y: pad.y }
  const courtyardHit = isPolygon(part.courtyard) && onKeepoutLayer(part.side, keepout) && polygonsOverlap(part.courtyard, keepout.outline)
  return courtyardHit ? at(part) : undefined
}

function keepoutChecks(parts: readonly PlacedFootprint[], keepouts: readonly Keepout[]): Violation[] {
  const usable = keepouts.filter((k) => isPolygon(k.outline))
  return parts.flatMap((part) =>
    usable.flatMap((keepout) => {
      const hit = keepoutHit(part, keepout)
      if (hit === undefined) return []
      return [violation("keepout", "error", `${part.component} lies inside ${keepout.id}`, [part.component, keepout.id], "pcb", hit)]
    }),
  )
}

// ---- silkscreen against pads ----

const exposedOn = (pad: WorldPad, side: PlacedFootprint["side"]) => pad.layers === "through" || pad.layers === side

function nearestSilk(part: PlacedFootprint, shape: Shape): number {
  const distances = part.silkscreen.flatMap((line) => segments(line, false).map(([a, b]) => shapeToSegmentDistance(shape, a, b)))
  return distances.reduce((a, b) => Math.min(a, b), Infinity)
}

function silkOnPad(part: PlacedFootprint, rules: Rules): Violation[] {
  const minimum = rules.fabrication.minSilkToPad
  return part.pads.flatMap((pad) => {
    const shape = padShape(pad)
    if (shape === undefined || !exposedOn(pad, part.side)) return []
    const distance = nearestSilk(part, shape)
    if (!breaksMinimum(distance, minimum)) return []
    const how = distance > 0 ? `${mm(distance)} mm from` : "on"
    const message = `Silkscreen of ${part.component} is ${how} ${pad.id}; the minimum is ${mm(minimum)} mm`
    return [violation("silk-on-pad", "warning", message, [part.component, pad.id], "pcb", { x: pad.x, y: pad.y })]
  })
}

// ---- board-level notes ----

function unplaced(parts: readonly PlacedFootprint[]): Violation[] {
  const auto = parts.filter((p) => p.autoPlaced).sort(byComponent)
  const first = auto[0]
  if (first === undefined) return []
  const message = "These parts have no position and were placed automatically"
  return [violation("unplaced", "warning", message, auto.map((p) => p.component), "pcb", at(first))]
}

function unrouted(layout: PcbLayout): Violation[] {
  const count = layout.ratsnest.length
  return count > 0 ? [violation("unrouted", "warning", `${count} connections are not routed yet`, [], "pcb")] : []
}

function noOutline(): Violation {
  return violation("unchecked", "warning", "no board outline: edge and outside-board checks were not run", [], "pcb")
}

/** Every part check on the layout, sorted by id. Nothing here changes the layout. */
export function partChecks(layout: PcbLayout, rules: Rules): Violation[] {
  const { board, parts } = layout
  const outline = usableOutline(board) ? (board?.outline ?? []) : undefined
  const found = [
    ...courtyardOverlaps(parts),
    ...(outline ? outsideBoard(parts, outline) : [noOutline()]),
    ...keepoutChecks(parts, board?.keepouts ?? []),
    ...parts.flatMap((p) => silkOnPad(p, rules)),
    ...unplaced(parts),
    ...unrouted(layout),
  ]
  return found.sort((a, b) => naturalCompare(a.id, b.id))
}
