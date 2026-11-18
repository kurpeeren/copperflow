// A shielded surface-mount power inductor: a dark grey ferrite block on the footprint's body outline with its four
// corners clipped and a slightly lighter top with a small mark near pad 1, and a tinned terminal folded over the block's
// end onto each pad. Pure.
import { firstPad, type ShapeInput } from "./input.js"
import { circle, clipped, grown, prism, type Flat, type Piece, type Rect } from "./kit.js"
import { foldedTerminal, type FoldSpec } from "./uno-kit.js"

/** The block stands this far off the board at most (share of the height); the mark is this high at most (share). */
const STANDOFF = 0.08
const STANDOFF_SHARE = 0.05
const MARK_RISE = 0.04
const MARK_SHARE = 0.03
/** A corner is clipped by this share of the side, at most. */
const CLIP_SHARE = 0.1
const CLIP_MOST = 0.8
/** The mark's radius (share of the side, at least) and how far in from the edges its middle is (share of the side). */
const MARK_RADIUS_SHARE = 0.05
const MARK_RADIUS_LEAST = 0.18
const MARK_INSET_SHARE = 0.22
const MARK_SIDES = 12
/** A terminal's foot thickness at most and share of the height, its rise at most and share of the height; across is this share of the side. */
const FOOT = 0.15
const FOOT_SHARE = 0.2
const RISE = 0.9
const RISE_SHARE = 0.5
const ACROSS_SHARE = 0.8
const TERMINAL_REACH = 3

/** A rectangle's outline counter-clockwise with all four corners cut by `cut`. */
function clippedRect(r: Rect, cut: number): Flat[] {
  return [
    { x: r.minX + cut, y: r.minY }, { x: r.maxX - cut, y: r.minY }, { x: r.maxX, y: r.minY + cut }, { x: r.maxX, y: r.maxY - cut },
    { x: r.maxX - cut, y: r.maxY }, { x: r.minX + cut, y: r.maxY }, { x: r.minX, y: r.maxY - cut }, { x: r.minX, y: r.minY + cut },
  ]
}

export function inductorShape(input: ShapeInput): Piece[] {
  const body = clipped(input.body ?? grown(input.limit, -0.25), input.limit)
  const { look } = input
  const h = input.height
  const side = Math.min(body.maxX - body.minX, body.maxY - body.minY)
  const rise = Math.min(MARK_RISE, h * MARK_SHARE)
  const one = firstPad(input.pads)
  const left = one === undefined || one.x <= (body.minX + body.maxX) / 2
  const inset = side * MARK_INSET_SHARE
  const mark = circle(left ? body.minX + inset : body.maxX - inset, body.maxY - inset, Math.max(side * MARK_RADIUS_SHARE, MARK_RADIUS_LEAST), MARK_SIDES)
  const fold: FoldSpec = { reach: TERMINAL_REACH, thick: Math.min(FOOT, h * FOOT_SHARE), rise: Math.min(RISE, h * RISE_SHARE), across: side * ACROSS_SHARE }
  const pieces: Piece[] = [
    ...prism(clippedRect(body, Math.min(side * CLIP_SHARE, CLIP_MOST)), Math.min(STANDOFF, h * STANDOFF_SHARE), h - rise, { top: look.top ?? look.body, side: look.body }, "matt", "body"),
    ...prism(mark, h - rise, h, look.mark, "matt", "pin1"),
  ]
  for (const pad of input.pads) pieces.push(...foldedTerminal(pad, body, fold, look.metal))
  return pieces
}
