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
 * Whether a rounded corner may go in: the design-rule checks the copper checks run (clearance to other nets' copper and
 * to pads, the board edge, keepouts grown by the minimum clearance) measured on the arc's chords alone, against
 * everything but the track itself; and the arc must still touch whatever of its own net met the square corner.
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

function arcPiece(track: PcbTrack, arc: readonly Point[], classOf: ClassOf): CopperPiece {
  const shapes = arc.slice(1).map((p, i): Shape => ({ core: [arc[i] as Point, p], radius: track.width / 2 }))
  const net = track.net === undefined ? {} : { net: track.net }
  return { id: track.id, kind: "track", ...net, className: classOf(track.net), layers: [track.layer], shapes, at: arc[0] as Point, pads: track.pads }
}

const touches = (a: CopperPiece, shapes: readonly Shape[]) => a.shapes.some((one) => shapes.some((other) => copperTouches(one, other)))

/** What of the track's own net met the square corner and the arc would no longer touch. */
function leftBehind(near: readonly CopperPiece[], track: PcbTrack, corner: Point, arc: CopperPiece): boolean {
  const disc: Shape[] = [{ core: [corner], radius: track.width / 2 }]
  return near.some((piece) => piece.net === track.net && touches(piece, disc) && !touches(piece, arc.shapes))
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

/** The guard for one track's corners: the reason a proposed arc may not go in, or undefined when it may. */
export function filletGuard(context: GuardContext, pieces: GuardPieces, track: PcbTrack): CornerGuard {
  const onLayer = (piece: CopperPiece) => piece.id !== track.id && piece.layers.includes(track.layer)
  const [copper, pads] = [pieces.copper.filter(onLayer), pieces.pads.filter(onLayer)]
  return (corner, arc) => {
    const piece = arcPiece(track, arc, context.classOf)
    const area = grown(boxOf([...piece.shapes, { core: [corner], radius: track.width / 2 }]), pieces.reach + track.width)
    const isNear = (one: CopperPiece) => overlaps(boxOf(one.shapes), area)
    const [nearCopper, nearPads] = [copper.filter(isNear), pads.filter(isNear)]
    if (leftBehind([...nearCopper, ...nearPads], track, corner, piece)) return "joined at the corner"
    const clash = clearanceChecks([piece, ...nearCopper], nearPads, context.rules).find((violation) => violation.items.includes(track.id))
    if (clash) return `too close to ${nameOfOther(clash.items, track, [...nearCopper, ...nearPads], context)}`
    return placementReason(piece, context)
  }
}
