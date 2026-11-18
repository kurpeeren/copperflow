// A chip resistor array: one ceramic body under a dark coat, with a small tinned terminal over each pad at its edge. Pure.
import { clipPieces } from "./chip.js"
import { padsRect, type ShapeInput } from "./input.js"
import { box, clipped, grown, type Piece } from "./kit.js"
import { bodyBand } from "./gullwing.js"
import { terminal } from "./smd.js"

/** The body stands this far off the board. */
const STANDOFF = 0.03
/** A terminal reaches this far under the body and out past it, mm, and stands this share of the height. */
const INSIDE = 0.12
const OUTSIDE = 0.1
const TERMINAL_SHARE = 0.7

export function arrayShape(input: ShapeInput): Piece[] {
  const reach = padsRect(input.pads)
  const body = clipped(input.body ?? (reach ? grown(reach, -0.1) : input.limit), input.limit)
  const h = input.height
  const { look } = input
  const band = bodyBand(h)
  const pieces: Piece[] = [...box(body, Math.min(STANDOFF, band.bottom), band.top, { top: look.top ?? look.body, side: look.body }, "matt", "body")]
  for (const pad of input.pads) pieces.push(...terminal(pad, body, { inside: INSIDE, outside: OUTSIDE, height: h * TERMINAL_SHARE }, look.metal))
  return clipPieces(pieces, input.limit)
}
