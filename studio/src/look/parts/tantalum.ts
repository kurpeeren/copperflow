// A moulded tantalum capacitor: an amber block with a darker stripe across its top at the plus end (pad 1) and a tinned
// terminal wrapped over each end of the body, down to its pad. Pure.
import type { ShapeInput } from "./input.js"
import { box, type Piece, type Rect } from "./kit.js"
import { bodyBand } from "./gullwing.js"
import { settle, twoPads } from "./smd.js"

/** How far a terminal wraps up the end, as a share of the height, how far past the body it stands and in under it, mm. */
const WRAP = 0.62
const THICK = 0.12
const TUCK = 0.8
/** The stripe's share of the body's length, and its least length, mm. */
const STRIPE_SHARE = 0.16
const STRIPE_LEAST = 0.3

export function tantalumShape(input: ShapeInput): Piece[] {
  const axis = twoPads(input)
  if (axis === undefined) return []
  const [half, across] = [axis.bodyAlong / 2, axis.bodyAcross / 2]
  const h = input.height
  const { bottom, top } = bodyBand(h)
  const { look } = input
  const local = (minX: number, maxX: number, y: number): Rect => ({ minX, maxX, minY: -y, maxY: y })
  const stripe = Math.max(axis.bodyAlong * STRIPE_SHARE, STRIPE_LEAST)
  const wide = Math.min(across, axis.padAcross / 2) * 0.9
  const pieces: Piece[] = [
    ...box(local(-half, half, across), bottom, top, look.body, "matt", "body"),
    ...box(local(-half + stripe * 0.5, -half + stripe * 1.5, across), top, h, look.mark, "matt", "pin1"),
    ...box(local(-half - THICK, -half + TUCK, wide), 0, h * WRAP, look.metal, "metal", "cap"),
    ...box(local(half - TUCK, half + THICK, wide), 0, h * WRAP, look.metal, "metal", "cap"),
  ]
  return settle(pieces, axis, input)
}
