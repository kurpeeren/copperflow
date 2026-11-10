import { usableOutline } from "../board.js"
import { copperTouches } from "../copper.js"
import type { CornerGuard } from "../fillet.js"
import type { Point } from "../model.js"
import type { PcbLayout, PcbTrack } from "../pcb.js"
import { DEFAULT_CLASS } from "../rules/profiles.js"
import type { Rules } from "../rules/schema.js"
import { clearanceChecks } from "./copper-clearance.js"
import { copperPieces, padPieces, type ClassOf, type CopperPiece } from "./copper-pieces.js"
import { boardEdge, keepoutHit } from "./drc-copper.js"
import { bounds, type Shape } from "./geometry.js"
import type { Box } from "./grid-index.js"

/**
 * Whether a corner may change, rounded (the arc takes the place of the legs it cuts off) or straightened (the legs take
 * the place of the arc): the design-rule checks the copper checks run (clearance to other nets' copper and to pads, the
 * board edge, keepouts grown by the minimum clearance) measured on the new copper alone, against everything but the
 * track itself; and the new copper must still touch whatever of the track's own net joined the copper it replaces.
 */

export interface GuardContext {
  layout: PcbLayout
  rules: Rules
  classOf: ClassOf
  /** A net's name as the summary says it, from its id. */
  netName(id: string): string
}

/** The board's pieces, made once for all the tracks a command rounds. */
export interface GuardPieces {
  copper: CopperPiece[]
  pads: CopperPiece[]
  /** The widest clearance any two classes can need: how far around an arc to look. */
  reach: number
}

const overlaps = (a: Box, b: Box) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY
const grown = (box: Box, by: number): Box => ({ minX: box.minX - by, minY: box.minY - by, maxX: box.maxX + by, maxY: box.maxY + by })

function boxOf(shapes: readonly Shape[]): Box {
  return shapes.map(bounds).reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) }))
}

export function guardPieces({ layout, rules, classOf }: GuardContext): GuardPieces {
  const clearances = [rules.fabrication.minClearance, DEFAULT_CLASS.clearance, ...rules.classes.map((c) => c.clearance), ...rules.classClearance.map((c) => c.clearance)]
  return { copper: copperPieces(layout, classOf), pads: padPieces(layout, classOf), reach: Math.max(...clearances) }
}

/** The copper of a path of the track: one shape per segment, the track's width. */
const pathShapes = (track: PcbTrack, path: readonly Point[]): Shape[] => path.slice(1).map((p, i): Shape => ({ core: [path[i] as Point, p], radius: track.width / 2 }))

function pathPiece(track: PcbTrack, path: readonly Point[], classOf: ClassOf): CopperPiece {
  const net = track.net === undefined ? {} : { net: track.net }
  return { id: track.id, kind: "track", ...net, className: classOf(track.net), layers: [track.layer], shapes: pathShapes(track, path), at: path[0] as Point, pads: track.pads }
}

const touches = (a: CopperPiece, shapes: readonly Shape[]) => a.shapes.some((one) => shapes.some((other) => copperTouches(one, other)))

/** Whether copper of the track's own net joins the copper that goes and would not touch the copper that comes. */
function leftBehind(near: readonly CopperPiece[], track: PcbTrack, gone: readonly Shape[], coming: CopperPiece): boolean {
  return near.some((piece) => piece.net === track.net && touches(piece, gone) && !touches(piece, coming.shapes))
}

/** The other piece a clearance violation of the arc names, as the summary says it: its net, else its id. */
function nameOfOther(items: readonly string[], track: PcbTrack, near: readonly CopperPiece[], context: GuardContext): string {
  const id = items.find((item) => item !== track.id) ?? ""
  const piece = near.find((one) => one.id === id)
  return piece?.net === undefined ? id : context.netName(piece.net)
}

function placementReason(arc: CopperPiece, context: GuardContext): string | undefined {
  const board = context.layout.board
  if (board === undefined) return undefined
  if (usableOutline(board) && boardEdge(arc, board.outline, context.rules)) return "too close to the board edge"
  const wide = { ...arc, shapes: arc.shapes.map((shape) => ({ ...shape, radius: shape.radius + context.rules.fabrication.minClearance })) }
  const keepout = board.keepouts.find((one) => one.outline.length >= 3 && keepoutHit(wide, one))
  return keepout ? `too close to ${keepout.id}` : undefined
}

/** The pieces of the board near a track's layer, and how to check one corner change of it. */
function cornerCheck(context: GuardContext, pieces: GuardPieces, track: PcbTrack) {
  const onLayer = (piece: CopperPiece) => piece.id !== track.id && piece.layers.includes(track.layer)
  const [copper, pads] = [pieces.copper.filter(onLayer), pieces.pads.filter(onLayer)]
  /** The reason the path `coming` may not take the place of `going`, or undefined when it may. */
  return (coming: readonly Point[], going: readonly Point[], joined: string): string | undefined => {
    const piece = pathPiece(track, coming, context.classOf)
    const gone = pathShapes(track, going)
    const area = grown(boxOf([...piece.shapes, ...gone]), pieces.reach + track.width)
    const isNear = (one: CopperPiece) => overlaps(boxOf(one.shapes), area)
    const [nearCopper, nearPads] = [copper.filter(isNear), pads.filter(isNear)]
    if (leftBehind([...nearCopper, ...nearPads], track, gone, piece)) return joined
    const clash = clearanceChecks([piece, ...nearCopper], nearPads, context.rules).find((violation) => violation.items.includes(track.id))
    if (clash) return `too close to ${nameOfOther(clash.items, track, [...nearCopper, ...nearPads], context)}`
    return placementReason(piece, context)
  }
}

/** The legs of a corner that its arc replaces: from the arc's start to the corner to the arc's end. */
const legsOf = (corner: Point, arc: readonly Point[]): Point[] => [arc[0] as Point, corner, arc.at(-1) as Point]

/** The guard for rounding one track's corners: the reason a proposed arc may not go in, or undefined when it may. */
export function filletGuard(context: GuardContext, pieces: GuardPieces, track: PcbTrack): CornerGuard {
  const check = cornerCheck(context, pieces, track)
  return (corner, arc) => check(arc, legsOf(corner, arc), "joined on the corner's legs")
}

/** The guard for straightening one track's corners: the same checks on the square corner that would replace the arc. */
export function straightenGuard(context: GuardContext, pieces: GuardPieces, track: PcbTrack): CornerGuard {
  const check = cornerCheck(context, pieces, track)
  return (corner, arc) => check(legsOf(corner, arc), arc, "joined on the arc")
}
