import { usableOutline } from "../board.js"
import type { Board, Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout, WorldPad } from "../pcb.js"
import { requiredClearance } from "../rules/classes.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import type { Rules } from "../rules/schema.js"
import { bounds, closestPoints, drillShape, padShape, pointInPolygon, shapeDistance, shapeToSegmentDistance, type Shape } from "./geometry.js"
import { GridIndex, type Box } from "./grid-index.js"
import { breaksMinimum } from "./limits.js"
import { violation, type Violation } from "./violation.js"

/**
 * Placement checks on pads and holes: copper clearance between nets, distance to the board edge,
 * drill size, annular ring and hole-to-hole spacing. Every limit is a minimum, so a value breaks it
 * when it is smaller (by more than LENGTH_TOLERANCE); a value equal to the limit passes.
 */

/** Side of a cell in the pad index, in mm: about the size of a small pad. */
const CELL = 1

/** A pad with what the checks need, worked out once. `rank` is its place in natural id order. */
interface CheckedPad {
  pad: WorldPad
  rank: number
  className: string
  /** Undefined for a pad shape the checks do not know. */
  copper: Shape | undefined
  hole: Shape | undefined
}

const mm = (value: number) => value.toFixed(3)
const centre = (pad: WorldPad): Point => ({ x: pad.x, y: pad.y })
const isDefined = <T>(value: T | undefined): value is T => value !== undefined
const smallest = (values: readonly number[]) => values.reduce((a, b) => Math.min(a, b), Infinity)
const largest = (values: readonly number[]) => values.reduce((a, b) => Math.max(a, b), -Infinity)
const midpoint = ([a, b]: [Point, Point]): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const gap = (distance: number) => (distance > 0 ? `${mm(distance)} mm apart` : "touching or overlapping")
const classPair = (a: string, b: string) => (a === b ? a : `${a}–${b}`)

/** A through pad has copper on both sides; top and bottom pads only on their own. */
const sharesCopper = (a: WorldPad["layers"], b: WorldPad["layers"]) => a === "through" || b === "through" || a === b
/**
 * Pads are one conductor when they share a net, or belong to one pin: the same pad number on one
 * component, or the same pin. Otherwise a pad without a net stands alone, apart from every other pad.
 */
const oneConductor = (a: WorldPad, b: WorldPad) =>
  (a.net !== undefined && a.net === b.net) || (a.component === b.component && a.number === b.number) || (a.pin !== undefined && a.pin === b.pin)

/** Every pad in natural id order. A pad without a net is in the default class, whatever classOf says. */
function checkedPads(layout: PcbLayout, classOf: (net: string | undefined) => string): CheckedPad[] {
  const pads = layout.parts.flatMap((part) => part.pads).sort((a, b) => naturalCompare(a.id, b.id))
  return pads.map((pad, rank) => ({
    pad,
    rank,
    className: pad.net === undefined ? DEFAULT_CLASS.name : classOf(pad.net),
    copper: padShape(pad),
    hole: drillShape(pad),
  }))
}

// ---- one pad at a time ----

function unchecked({ pad, copper }: CheckedPad): Violation | undefined {
  if (copper !== undefined) return undefined
  const message = `${pad.id} has the pad shape "${String(pad.shape)}", which the checks do not know; its copper is not checked`
  return violation("unchecked", "warning", message, [pad.id], "pcb", centre(pad))
}

/** A slot is cut with a tool as wide as its narrow side, so that side is the drill size. */
function drillSize({ pad }: CheckedPad, rules: Rules): Violation | undefined {
  if (pad.drill === undefined) return undefined
  const narrow = Math.min(pad.drill.width, pad.drill.height)
  const minimum = rules.fabrication.minDrill
  if (!breaksMinimum(narrow, minimum)) return undefined
  return violation("drill-size", "error", `${pad.id} has a ${mm(narrow)} mm drill; the minimum is ${mm(minimum)} mm`, [pad.id], "pcb", centre(pad))
}

/**
 * The thinnest copper around a pad's hole. The hole is centred on the pad and turned with it, so for
 * every pad shape, and for a slot along or across the pad, the thinnest copper lies on one of the
 * pad's own axes. For a round hole this is (min(width, height) - drill) / 2. A circle pad is as tall
 * as it is wide.
 */
function ringWidth(pad: WorldPad, drill: { width: number; height: number }): number {
  const height = pad.shape === "circle" ? pad.width : pad.height
  return Math.min(pad.width - drill.width, height - drill.height) / 2
}

function annularRing({ pad, copper }: CheckedPad, rules: Rules): Violation | undefined {
  if (pad.layers !== "through" || pad.drill === undefined || copper === undefined) return undefined
  const ring = ringWidth(pad, pad.drill)
  const minimum = rules.fabrication.minAnnularRing
  if (!breaksMinimum(ring, minimum)) return undefined
  const message =
    ring > 0
      ? `${pad.id} has a ${mm(ring)} mm annular ring; the minimum is ${mm(minimum)} mm`
      : `The hole of ${pad.id} reaches the edge of its pad or beyond; the minimum annular ring is ${mm(minimum)} mm`
  return violation("annular-ring", "error", message, [pad.id], "pcb", centre(pad))
}

function outlineDistance(shape: Shape, outline: readonly Point[]): number {
  return smallest(outline.map((p, i) => shapeToSegmentDistance(shape, p, outline[(i + 1) % outline.length] as Point)))
}

/**
 * The pad's copper and its hole against every outline edge; a pad centred outside the board fails
 * outright. Skipped without a usable outline, which the board checks report.
 */
function boardEdge({ pad, copper, hole }: CheckedPad, board: Board | undefined, rules: Rules): Violation | undefined {
  if (board === undefined || !usableOutline(board)) return undefined
  const minimum = rules.fabrication.boardEdgeClearance
  const report = (message: string) => violation("board-edge", "error", message, [pad.id], "pcb", centre(pad))
  if (!pointInPolygon(centre(pad), board.outline)) return report(`${pad.id} is outside the board`)
  const distance = smallest([copper, hole].filter(isDefined).map((shape) => outlineDistance(shape, board.outline)))
  if (!breaksMinimum(distance, minimum)) return undefined
  return report(
    distance > 0
      ? `${pad.id} is ${mm(distance)} mm from the board edge; the minimum is ${mm(minimum)} mm`
      : `${pad.id} crosses the board edge; the minimum gap to it is ${mm(minimum)} mm`,
  )
}

function singleChecks(p: CheckedPad, board: Board | undefined, rules: Rules): Violation[] {
  return [unchecked(p), drillSize(p, rules), annularRing(p, rules), boardEdge(p, board, rules)].filter(isDefined)
}

// ---- pairs of pads ----

function clearance(a: CheckedPad, b: CheckedPad, rules: Rules): Violation | undefined {
  if (a.copper === undefined || b.copper === undefined) return undefined
  if (!sharesCopper(a.pad.layers, b.pad.layers) || oneConductor(a.pad, b.pad)) return undefined
  const required = requiredClearance(rules, a.className, b.className)
  const distance = shapeDistance(a.copper, b.copper)
  if (!breaksMinimum(distance, required)) return undefined
  const message = `${a.pad.id} and ${b.pad.id} are ${gap(distance)}; ${classPair(a.className, b.className)} needs ${mm(required)} mm`
  return violation("clearance", "error", message, [a.pad.id, b.pad.id], "pcb", midpoint(closestPoints(a.copper, b.copper)))
}

/** Holes on any nets, the same one included. */
function holeToHole(a: CheckedPad, b: CheckedPad, rules: Rules): Violation | undefined {
  if (a.hole === undefined || b.hole === undefined) return undefined
  const minimum = rules.fabrication.minHoleToHole
  const distance = shapeDistance(a.hole, b.hole)
  if (!breaksMinimum(distance, minimum)) return undefined
  const message = `The holes of ${a.pad.id} and ${b.pad.id} are ${gap(distance)}; the minimum is ${mm(minimum)} mm`
  return violation("hole-to-hole", "error", message, [a.pad.id, b.pad.id], "pcb", midpoint(closestPoints(a.hole, b.hole)))
}

/** The box around a pad's copper and its hole, or undefined when it has neither. */
function reach({ copper, hole }: CheckedPad): Box | undefined {
  const boxes = [copper, hole].filter(isDefined).map(bounds)
  if (boxes.length === 0) return undefined
  return {
    minX: smallest(boxes.map((box) => box.minX)),
    minY: smallest(boxes.map((box) => box.minY)),
    maxX: largest(boxes.map((box) => box.maxX)),
    maxY: largest(boxes.map((box) => box.maxY)),
  }
}

const grow = (box: Box, by: number): Box => ({ minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by })

/** The farthest apart two pads can be and still break a rule: the widest gap any two classes in use need, or the hole spacing. */
function searchDistance(pads: readonly CheckedPad[], rules: Rules): number {
  const names = [...new Set(pads.map((p) => p.className))]
  const clearances = names.flatMap((a) => names.map((b) => requiredClearance(rules, a, b)))
  return largest([rules.fabrication.minHoleToHole, ...clearances])
}

/** Each pair once: a pad is compared only with pads after it in natural id order. */
function pairChecks(pads: readonly CheckedPad[], rules: Rules): Violation[] {
  const placed = pads.flatMap((p) => {
    const box = reach(p)
    return box === undefined ? [] : [{ p, box }]
  })
  const index = new GridIndex<CheckedPad>(CELL)
  for (const { p, box } of placed) index.insert(p, box)
  const distance = searchDistance(pads, rules)
  return placed.flatMap(({ p: a, box }) =>
    index
      .query(grow(box, distance))
      .filter((b) => b.rank > a.rank)
      .flatMap((b) => [clearance(a, b, rules), holeToHole(a, b, rules)].filter(isDefined)),
  )
}

/**
 * Every pad check on the layout, sorted by id. `classOf` gives the net class of a net; pads without a
 * net are in the default class. The board-edge check is skipped when there is no board outline.
 */
export function padChecks(layout: PcbLayout, rules: Rules, classOf: (net: string | undefined) => string): Violation[] {
  const pads = checkedPads(layout, classOf)
  const found = [...pads.flatMap((p) => singleChecks(p, layout.board, rules)), ...pairChecks(pads, rules)]
  return found.sort((a, b) => naturalCompare(a.id, b.id))
}
