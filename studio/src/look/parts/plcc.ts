// A PLCC chip: a dark body on its outline raised off the board, with its top-left corner clipped and a dot above pin 1,
// and a J-lead on every pad: a stub out of the body's side, a riser down it and a foot tucked in under the body. Pure.
import { clipPieces } from "./chip.js"
import { bodyBand, bodyRect } from "./gullwing.js"
import { firstPad, type ShapeInput } from "./input.js"
import { circle, prism, type Piece } from "./kit.js"
import { clippedCorner, jLead, sideOf } from "./smd.js"

/** The body stands this far off the board; the lead strips are this thick, mm. */
const STANDOFF = 0.5
const STRIP = 0.2
/** The leads leave the body at this share of its height (at most `RISE_MOST`), and tuck in this far, mm. */
const RISE_SHARE = 0.3
const RISE_MOST = 1.5
const TUCK = 0.9
/** The pad's end beyond the lead's outer face, mm: the toe of the land. */
const TOE = 0.3
/** The corner is clipped by this much, the dot is this big and stands this far in from the top edge, mm. */
const CLIP = 1.2
const DOT_RADIUS = 0.5
const DOT_INSET = 1.3

export function plccShape(input: ShapeInput): Piece[] {
  const body = input.body ?? bodyRect(input)
  const h = input.height
  const { top } = bodyBand(h)
  const standoff = Math.min(STANDOFF, h * 0.2)
  const strip = Math.min(STRIP, h * 0.1)
  const { look } = input
  const rise = Math.min(h * RISE_SHARE, RISE_MOST)
  const pieces: Piece[] = [...prism(clippedCorner(body, -1, 1, CLIP), standoff, top, look.body, "matt", "body")]
  for (const pad of input.pads) pieces.push(...jLead(pad, sideOf(pad, body), body, { reach: 0.6, toe: TOE, thick: strip, rise, tuck: TUCK, across: 0.5 }, look.metal))
  const one = firstPad(input.pads)
  if (one !== undefined) pieces.push(...prism(circle(one.x, body.maxY - DOT_INSET, DOT_RADIUS, 14), top - 0.01, h, look.mark, "matt", "pin1"))
  return clipPieces(pieces, input.limit)
}
