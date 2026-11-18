// A ball grid array: a thin substrate on the body outline standing on a ball under every pad, a slightly smaller dark
// mould cap on top and a pin 1 dot (the ball A1 corner). A small grid gets domed balls; a big one gets plain short
// prisms, so a 256-ball part stays cheap. Pure.
import { pin1Dot } from "./gullwing.js"
import { padRect, padsRect, type ShapeInput } from "./input.js"
import { box, circle, clipped, grown, lathe, prism, type Piece, type Rect } from "./kit.js"
import type { Pad } from "../../../../src/engine/footprints/types.js"

/** The ball is this much wider than the land it sits on (a collapsed ball is wider than its land). */
const BALL_OVER_LAND = 1.3
/** The ball's height as a share of its width, and of the part's whole height at most. */
const BALL_SQUASH = 0.8
const BALL_HEIGHT_SHARE = 0.3
/** The substrate's thickness, and the share of what is left above the balls it may take at most. */
const SUBSTRATE = 0.25
const SUBSTRATE_SHARE = 0.3
/** The cap stands in from the substrate's edge by this, or this share of the body's smaller side. */
const CAP_INSET = 0.4
const CAP_INSET_SHARE = 0.06
/** Up to this many balls are domed (barrel lathe, 8 sides); more are prisms of 6 sides, past `MANY` of 4. */
const DOMED_LIMIT = 64
const MANY = 400
/** The pin 1 dot stands this far in from the cap's corner (beyond its own radius), so it stays by ball A1. */
const DOT_ROOM = 0.1

const landOf = (pad: Pad): number => Math.min(padRect(pad).maxX - padRect(pad).minX, padRect(pad).maxY - padRect(pad).minY)

/** One ball standing on the board at the pad, of `width` across and `height` tall. */
function ball(pad: Pad, width: number, height: number, count: number, color: ShapeInput["look"]["metal"]): Piece[] {
  const radius = width / 2
  if (count <= DOMED_LIMIT) return lathe([[radius * 0.55, 0], [radius, height * 0.5], [radius * 0.6, height]], pad.x, pad.y, 8, color, "metal", "pin")
  return prism(circle(pad.x, pad.y, radius * 0.85, count <= MANY ? 6 : 4), 0, height, color, "metal", "pin")
}

export function bgaShape(input: ShapeInput): Piece[] {
  const extent = padsRect(input.pads)
  const outline = clipped(input.body ?? grown(extent ?? input.limit, 0.3), input.limit)
  const { look } = input
  const h = input.height
  const land = Math.min(...input.pads.map(landOf), Infinity)
  const width = Number.isFinite(land) ? land * BALL_OVER_LAND : 0.4
  const ballHeight = Math.min(width * BALL_SQUASH, h * BALL_HEIGHT_SHARE)
  const substrate = Math.min(SUBSTRATE, (h - ballHeight) * SUBSTRATE_SHARE)
  const small = Math.min(outline.maxX - outline.minX, outline.maxY - outline.minY)
  const cap: Rect = grown(outline, -Math.min(CAP_INSET, small * CAP_INSET_SHARE))
  const top = h - 0.02
  const colorOfSubstrate = look.top ?? look.body
  const pieces: Piece[] = [
    ...input.pads.flatMap((pad) => ball(pad, width, ballHeight, input.pads.length, look.metal)),
    ...box(outline, ballHeight, ballHeight + substrate, colorOfSubstrate, "matt", "body"),
    ...box(cap, ballHeight + substrate, top, look.body, "matt", "body"),
    ...pin1Dot(input, cap, top, DOT_ROOM),
  ]
  return pieces
}
