import { usableOutline } from "../board.js"
import type { PcbVia } from "../copper.js"
import type { Board, Keepout, Point } from "../model.js"
import { naturalCompare } from "../order.js"
import type { PcbLayout } from "../pcb.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import type { Rules } from "../rules/schema.js"
import { clearanceChecks } from "./copper-clearance.js"
import { copperPieces, padPieces, type ClassOf, type CopperPiece } from "./copper-pieces.js"
import { copperViolation, mm } from "./copper-violation.js"
import { closestPoints, pointInPolygon, shapeDistance, type Shape } from "./geometry.js"
import { breaksMinimum, LENGTH_TOLERANCE } from "./limits.js"
import type { Violation } from "./violation.js"

/**
 * The design-rule checks on the layout file's copper: clearance to copper and pads of other nets,
 * track width, via drill and annular ring, distance to the board edge, and copper inside keepouts.
 * Every limit is a minimum; a value equal to it passes.
 */

const isPolygon = (outline: readonly Point[]) => outline.length >= 3

// ---- track width ----

function classWidth(rules: Rules, name: string): number {
  return rules.classes.find((netClass) => netClass.name === name)?.trackWidth ?? DEFAULT_CLASS.trackWidth
}

function trackWidth(piece: CopperPiece, width: number, rules: Rules): Violation | undefined {
  const byClass = classWidth(rules, piece.className)
  const minimum = rules.fabrication.minTrackWidth
  const required = Math.max(byClass, minimum)
  if (!breaksMinimum(width, required)) return undefined
  const rule = byClass >= minimum ? `${piece.className} needs ${mm(byClass)} mm` : `the fabrication minimum is ${mm(minimum)} mm`
  return copperViolation("track-width", `${piece.id} is ${mm(width)} mm wide; ${rule}`, [piece.id], [piece.id], piece.at)
}

// ---- vias ----

function viaChecks(via: PcbVia, rules: Rules): Violation[] {
  const { minDrill, minAnnularRing } = rules.fabrication
  const ring = (via.diameter - via.drill) / 2
  const found: Violation[] = []
  if (breaksMinimum(via.drill, minDrill)) {
    found.push(copperViolation("via-drill", `${via.id} has a ${mm(via.drill)} mm drill; the minimum is ${mm(minDrill)} mm`, [via.id], [via.id], via.at))
  }
  if (breaksMinimum(ring, minAnnularRing)) {
    const message = `${via.id} has a ${mm(ring)} mm annular ring; the minimum is ${mm(minAnnularRing)} mm`
    found.push(copperViolation("via-ring", message, [via.id], [via.id], via.at))
  }
  return found
}

// ---- the board edge ----

interface Nearest {
  distance: number
  at: Point
}

function nearestEdge(shapes: readonly Shape[], outline: readonly Point[]): Nearest {
  let best: Nearest = { distance: Infinity, at: outline[0] as Point }
  for (const shape of shapes) {
    outline.forEach((p, i) => {
      const edge: Shape = { core: [p, outline[(i + 1) % outline.length] as Point], radius: 0 }
      const distance = shapeDistance(shape, edge)
      if (distance < best.distance) best = { distance, at: closestPoints(shape, edge)[1] }
    })
  }
  return best
}

/** Outside the outline and not on it: a point exactly on the edge crosses it, it does not leave the board. */
function strictlyOutside(p: Point, outline: readonly Point[]): boolean {
  return !pointInPolygon(p, outline) && nearestEdge([{ core: [p], radius: 0 }], outline).distance > LENGTH_TOLERANCE
}

/** The board-edge check on one piece: outside the board, or closer to its edge than the fabrication minimum. */
export function boardEdge(piece: CopperPiece, outline: readonly Point[], rules: Rules): Violation | undefined {
  const minimum = rules.fabrication.boardEdgeClearance
  const report = (message: string, at: Point) => copperViolation("copper-edge", message, [piece.id], [piece.id], at)
  const outside = piece.shapes.flatMap((shape) => shape.core).find((p) => strictlyOutside(p, outline))
  if (outside !== undefined) return report(`${piece.id} ${piece.kind === "track" ? "runs" : "is"} outside the board`, outside)
  const { distance, at } = nearestEdge(piece.shapes, outline)
  if (!breaksMinimum(distance, minimum)) return undefined
  const message =
    distance > 0
      ? `${piece.id} is ${mm(distance)} mm from the board edge; the minimum is ${mm(minimum)} mm`
      : `${piece.id} crosses the board edge; the minimum gap to it is ${mm(minimum)} mm`
  return report(message, at)
}

// ---- keepouts ----

const keepoutCovers = (keepout: Keepout, piece: CopperPiece) => keepout.layers === "all" || piece.layers.includes(keepout.layers)

/** Where a shape reaches inside the keepout by more than the tolerance; touching its edge is allowed. */
function insidePoint(shape: Shape, outline: readonly Point[]): Point | undefined {
  const inner = shape.core.find((p) => pointInPolygon(p, outline))
  if (inner !== undefined) return inner
  const area: Shape = { core: [...outline], radius: 0 }
  return shapeDistance(shape, area) < -LENGTH_TOLERANCE ? closestPoints(shape, area)[1] : undefined
}

/** The keepout check on one piece: copper reaching inside a keepout on one of its layers. */
export function keepoutHit(piece: CopperPiece, keepout: Keepout): Violation | undefined {
  if (!keepoutCovers(keepout, piece)) return undefined
  const at = piece.shapes.map((shape) => insidePoint(shape, keepout.outline)).find((p) => p !== undefined)
  if (at === undefined) return undefined
  return copperViolation("copper-keepout", `${piece.id} lies inside ${keepout.id}`, [piece.id, keepout.id], [piece.id, keepout.id], at)
}

// ---- all together ----

interface Records {
  widths: ReadonlyMap<string, number>
  vias: ReadonlyMap<string, PcbVia>
}

function singleChecks(piece: CopperPiece, records: Records, board: Board | undefined, rules: Rules): Violation[] {
  const width = records.widths.get(piece.id)
  const via = records.vias.get(piece.id)
  const keepouts = (board?.keepouts ?? []).filter((keepout) => isPolygon(keepout.outline))
  return [
    piece.kind === "track" && width !== undefined ? trackWidth(piece, width, rules) : undefined,
    ...(piece.kind === "via" && via !== undefined ? viaChecks(via, rules) : []),
    board !== undefined && usableOutline(board) ? boardEdge(piece, board.outline, rules) : undefined,
    ...keepouts.map((keepout) => keepoutHit(piece, keepout)),
  ].filter((v): v is Violation => v !== undefined)
}

/**
 * Every copper check on the layout's tracks and vias, sorted by id. `classOf` gives a net's class;
 * copper and pads on no net are in the default class. Without a board outline the edge check is skipped.
 */
export function copperChecks(layout: PcbLayout, rules: Rules, classOf: ClassOf): Violation[] {
  const copper = copperPieces(layout, classOf)
  if (copper.length === 0) return []
  const records: Records = { widths: new Map(layout.tracks.map((t) => [t.id, t.width])), vias: new Map(layout.vias.map((v) => [v.id, v])) }
  const found = [...copper.flatMap((piece) => singleChecks(piece, records, layout.board, rules)), ...clearanceChecks(copper, padPieces(layout, classOf), rules)]
  return found.sort((a, b) => naturalCompare(a.id, b.id))
}
