// A surface-mount ceramic resonator, 3.2 × 1.3 mm: a small pale ceramic body on the footprint's body outline under a
// tinned metal cap over most of its top, and on each of the three pads a tinned terminal wrapped over the body's two
// long sides. Pure.
import { padRect, type ShapeInput } from "./input.js"
import { box, clipped, grown, type Piece } from "./kit.js"

/** The ceramic stands this far off the board (at most, share of the height) and takes this share of the height; the cap sits in from its edge by this much at most and share of the short side. */
const STANDOFF = 0.04
const STANDOFF_SHARE = 0.05
const CERAMIC_SHARE = 0.62
const CAP_INSET = 0.1
const CAP_INSET_SHARE = 0.1
/** A terminal's half width at most, how far it reaches in and out of the body's side, and its height at most and share of the ceramic's. */
const TERMINAL_HALF = 0.18
const TUCK = 0.05
const OUT = 0.12
const TERMINAL_HEIGHT = 0.45
const TERMINAL_SHARE = 0.8

export function resonatorShape(input: ShapeInput): Piece[] {
  const body = clipped(input.body ?? grown(input.limit, -0.25), input.limit)
  const { look } = input
  const h = input.height
  const small = Math.min(body.maxX - body.minX, body.maxY - body.minY)
  const split = h * CERAMIC_SHARE
  const cap = grown(body, -Math.min(CAP_INSET, small * CAP_INSET_SHARE))
  const pieces: Piece[] = [
    ...box(body, Math.min(STANDOFF, h * STANDOFF_SHARE), split, look.body, "matt", "body"),
    ...box(cap, split, h, look.metal, "metal", "cap"),
  ]
  for (const pad of input.pads) {
    const r = padRect(pad)
    const x = { minX: Math.max(r.minX, pad.x - TERMINAL_HALF), maxX: Math.min(r.maxX, pad.x + TERMINAL_HALF) }
    const height = Math.min(TERMINAL_HEIGHT, split * TERMINAL_SHARE)
    const top = { ...x, minY: Math.max(r.minY, body.maxY - TUCK), maxY: Math.min(r.maxY, body.maxY + OUT) }
    const bottom = { ...x, minY: Math.max(r.minY, body.minY - OUT), maxY: Math.min(r.maxY, body.minY + TUCK) }
    pieces.push(...box(top, 0, height, look.metal, "metal", "leg"), ...box(bottom, 0, height, look.metal, "metal", "leg"))
  }
  return pieces
}
