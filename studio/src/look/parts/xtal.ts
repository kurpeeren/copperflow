// A surface-mount crystal or oscillator: a ceramic base under a metal lid a little smaller than it, a dot at pin 1 and a
// tinned terminal at each pad. The HC-49 SMD is a metal can with rounded ends on a low dark seat, a flat lead on each pad. Pure.
import { clipPieces } from "./chip.js"
import { bodyBand, pin1Dot } from "./gullwing.js"
import { padRect, type ShapeInput } from "./input.js"
import { box, clipped, grown, prism, stadium, type Piece, type Rect } from "./kit.js"
import { terminal } from "./smd.js"

/** The base stands this far off the board; a terminal climbs this high up it, at most, mm. */
const STANDOFF = 0.04
const TERMINAL_HEIGHT = 0.3
/** The lid takes this share of the height, and sits in from the base's edge by this share of its short side, at most 0.2 mm. */
const LID_SHARE = 0.4
const LID_INSET = 0.08
/** The HC-49 seat's share of the height, its least thickness, and how far the can sits in from the outline, mm. */
const SEAT_SHARE = 0.24
const FOOT = 0.15
const CAN_MARGIN = 0.25

function ceramicShape(input: ShapeInput, body: Rect): Piece[] {
  const h = input.height
  const { look } = input
  const small = Math.min(body.maxX - body.minX, body.maxY - body.minY)
  const lid = grown(body, -Math.min(small * LID_INSET, 0.2))
  const split = h * (1 - LID_SHARE)
  const pieces: Piece[] = [
    ...box(body, Math.min(STANDOFF, split / 2), split, look.body, "matt", "body"),
    ...box(lid, split, bodyBand(h).top, look.top ?? look.metal, "metal", "body"),
    ...pin1Dot(input, lid, bodyBand(h).top),
  ]
  for (const pad of input.pads) pieces.push(...terminal(pad, body, { inside: 0.3, outside: 0.1, height: Math.min(TERMINAL_HEIGHT, split * 0.8) }, look.metal))
  return pieces
}

/** A can on a seat, as the HC-49 SMD is made: flat tinned leads from under the seat out over the pads. */
function canShape(input: ShapeInput, body: Rect): Piece[] {
  const h = input.height
  const { look } = input
  const [length, width] = [body.maxX - body.minX, body.maxY - body.minY]
  const seatTop = Math.min(Math.max(h * SEAT_SHARE, 0.6), h / 2)
  const foot = Math.min(FOOT, seatTop / 3)
  const seat = grown(body, -0.15)
  const pieces: Piece[] = [
    ...box(seat, foot, seatTop, look.mark, "matt", "body"),
    ...prism(stadium((body.minX + body.maxX) / 2, (body.minY + body.maxY) / 2, length - 2 * CAN_MARGIN, width - 2 * CAN_MARGIN), seatTop, h, { top: look.top ?? look.body, side: look.body }, "metal", "body"),
  ]
  for (const pad of input.pads) pieces.push(...box(clipped(grown(padRect(pad), -0.1), input.limit), 0, foot, look.metal, "metal", "leg"))
  return pieces
}

export function xtalShape(input: ShapeInput): Piece[] {
  const body = clipped(input.body ?? grown(input.limit, -0.25), input.limit)
  const pieces = input.parsed?.kind === "hc" ? canShape(input, body) : ceramicShape(input, body)
  return clipPieces(pieces, input.limit)
}
