import { COPPER_LAYERS, type CopperLayer } from "../../core/layout-file.js"
import { copperTouches } from "../copper.js"
import type { Point } from "../model.js"
import { naturalCompare } from "../order.js"
import { requiredClearance } from "../rules/classes.js"
import type { Rules } from "../rules/schema.js"
import type { CopperPiece } from "./copper-pieces.js"
import { bounds, closestPoints, shapeDistance, type Shape } from "./geometry.js"
import { GridIndex, type Box } from "./grid-index.js"
import { breaksMinimum } from "./limits.js"
import { copperViolation, gap, mm } from "./copper-violation.js"
import type { Violation } from "./violation.js"

/**
 * Clearance between copper of different nets on a shared layer: track, via and pad against track and
 * via (pad against pad is the pad checks' job). One uniform grid per layer holds every shape; each
 * track or via shape looks only at the cells within the widest gap any two classes in use need.
 */

/** The smallest grid cell, in mm: a few pad widths, so a dense board does not fill millions of cells. */
const MIN_CELL = 2

interface Slot {
  piece: CopperPiece
  shape: Shape
  box: Box
  /** Natural id order among the tracks and vias; pads are -1 and never look themselves. */
  rank: number
}

/** The nearest two shapes of one pair of pieces seen so far, `a` first in natural id order. */
interface Nearest {
  a: Slot
  b: Slot
  distance: number
}

const grow = (box: Box, by: number): Box => ({ minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by })
const midpoint = ([a, b]: [Point, Point]): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const sameNet = (a: CopperPiece, b: CopperPiece) => a.net !== undefined && a.net === b.net

function slotsOf(pieces: readonly CopperPiece[], rankOf: (piece: CopperPiece) => number): Slot[] {
  return pieces.flatMap((piece) => piece.shapes.map((shape) => ({ piece, shape, box: bounds(shape), rank: rankOf(piece) })))
}

/** The widest gap any two classes in use need. */
function searchDistance(pieces: readonly CopperPiece[], rules: Rules): number {
  const names = [...new Set(pieces.map((piece) => piece.className))].sort(naturalCompare)
  return names.flatMap((a) => names.map((b) => requiredClearance(rules, a, b))).reduce((x, y) => Math.max(x, y), rules.fabrication.minClearance)
}

/** A pair worth measuring: another piece, not on one net, and (two copper pieces) each pair once. */
function candidate(from: Slot, to: Slot): boolean {
  if (to.piece === from.piece || sameNet(from.piece, to.piece)) return false
  return to.rank === -1 || to.rank > from.rank
}

function ordered(x: Slot, y: Slot): [Slot, Slot] {
  return naturalCompare(x.piece.id, y.piece.id) <= 0 ? [x, y] : [y, x]
}

function record(found: Map<string, Nearest>, from: Slot, to: Slot): void {
  const [a, b] = ordered(from, to)
  const key = `${a.piece.id}|${b.piece.id}`
  const distance = shapeDistance(a.shape, b.shape)
  const known = found.get(key)
  if (known === undefined || distance < known.distance) found.set(key, { a, b, distance })
}

function measureLayer(slots: readonly Slot[], reach: number, cell: number, found: Map<string, Nearest>): void {
  const index = new GridIndex<Slot>(cell)
  for (const slot of slots) index.insert(slot, slot.box)
  for (const from of slots) {
    if (from.rank === -1) continue
    for (const to of index.query(grow(from.box, reach))) if (candidate(from, to)) record(found, from, to)
  }
}

/**
 * True when copper.ts made the two one conductor: copper whose copper meets, a track that lists the pad, a via
 * centred on the pad. A pad with no net is never one conductor with copper, so copper on it is always reported.
 */
function joined({ a, b }: Nearest): boolean {
  if (a.piece.kind !== "pad" && b.piece.kind !== "pad") return copperTouches(a.shape, b.shape)
  const [pad, other] = a.piece.kind === "pad" ? [a, b] : [b, a]
  if (pad.piece.net === undefined) return false
  if (other.piece.kind === "track") return other.piece.pads?.includes(pad.piece.id) ?? false
  return other.shape.core.some((centre) => copperTouches(pad.shape, { core: [centre], radius: 0 }))
}

/** The two classes as the rules write them: a class-to-class entry's order, else the pieces' order. */
function pairName(rules: Rules, a: string, b: string): string {
  if (a === b) return a
  const entry = rules.classClearance.find((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))
  return entry === undefined ? `${a}–${b}` : `${entry.a}–${entry.b}`
}

/** What sets the gap: the classes (their clearances and their pair entry), or the fabrication minimum when it is larger. */
function ruleText(rules: Rules, a: string, b: string, required: number): string {
  const byClasses = requiredClearance({ ...rules, fabrication: { ...rules.fabrication, minClearance: 0 } }, a, b)
  return byClasses < required ? `the fabrication minimum is ${mm(required)} mm` : `${pairName(rules, a, b)} needs ${mm(required)} mm`
}

/** Two named nets that differ: copper.ts never leaves joined copper so, unless the copper touches no pad. */
const twoNets = ({ a, b }: Nearest) => a.piece.net !== undefined && b.piece.net !== undefined && a.piece.net !== b.piece.net

/**
 * Pieces copper.ts joined are one conductor, and it reports a short or floating copper; every other pair is
 * measured, and so is joined copper still carrying two nets (floating copper naming different nets).
 */
function judge(nearest: Nearest, rules: Rules): Violation | undefined {
  if (joined(nearest) && !twoNets(nearest)) return undefined
  const { a, b, distance } = nearest
  const required = requiredClearance(rules, a.piece.className, b.piece.className)
  if (!breaksMinimum(distance, required)) return undefined
  const message = `${a.piece.id} and ${b.piece.id} are ${gap(distance)}; ${ruleText(rules, a.piece.className, b.piece.className, required)}`
  return copperViolation("copper-clearance", message, [a.piece.id, b.piece.id], [a.piece.id, b.piece.id], midpoint(closestPoints(a.shape, b.shape)))
}

const onLayer = (layer: CopperLayer) => (slot: Slot) => slot.piece.layers.includes(layer)

/** Every clearance violation between `copper` (tracks and vias, natural id order) and `pads`, sorted by id. */
export function clearanceChecks(copper: readonly CopperPiece[], pads: readonly CopperPiece[], rules: Rules): Violation[] {
  if (copper.length === 0) return []
  const rank = new Map(copper.map((piece, i) => [piece, i]))
  const slots = [...slotsOf(copper, (piece) => rank.get(piece) ?? -1), ...slotsOf(pads, () => -1)]
  const reach = searchDistance([...copper, ...pads], rules)
  const cell = Math.max(MIN_CELL, reach)
  const found = new Map<string, Nearest>()
  for (const layer of COPPER_LAYERS) {
    const here = slots.filter(onLayer(layer))
    if (here.some((slot) => slot.rank !== -1)) measureLayer(here, reach, cell, found)
  }
  const keys = [...found.keys()].sort(naturalCompare)
  return keys.flatMap((key) => judge(found.get(key) as Nearest, rules) ?? [])
}
