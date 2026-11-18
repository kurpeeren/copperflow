// A 6 × 6 mm tact switch: a low black square base on the footprint's body outline, a tinned metal cover plate on top of
// it a little smaller, and a round black button standing out of the plate's middle (the usual short button, which
// brings the part to its height). The through-hole part has a square pin through each hole and a short strip from the
// pin to the base; the surface-mount part a gull-wing terminal on each pad, a foot on the pad and a riser up the base. Pure.
import { leads, type ShapeInput } from "./input.js"
import { box, circle, clipped, grown, prism, type Piece } from "./kit.js"
import { foldedTerminal, type FoldSpec } from "./uno-kit.js"

/** The base's share of the part's height, the cover's thickness at most and share of the height, and how far the cover is inside the base. */
const BASE_SHARE = 0.7
const COVER = 0.3
const COVER_SHARE = 0.07
const COVER_INSET = 0.25
const COVER_INSET_SHARE = 0.04
/** The button's radius at most and its share of the base's side. */
const BUTTON = 1.7
const BUTTON_SHARE = 0.28
const BUTTON_SIDES = 16
/** A through-hole pin's half size. */
const PIN_HALF = { x: 0.25, y: 0.25 }
/** The strips joining pin and base (through-hole) and the gull-wings (surface-mount): reach, thickness, rise (at most) and width. */
const STRIP: FoldSpec = { reach: 0.5, thick: 0.15, rise: 0.6, across: 0.9 }
const WING: FoldSpec = { reach: 1.2, thick: 0.15, rise: 1, across: 0.9 }
const THICK_SHARE = 0.1
const RISE_SHARE = 0.6

export function tactShape(input: ShapeInput): Piece[] {
  const base = clipped(input.body ?? grown(input.limit, -0.25), input.limit)
  const { look } = input
  const h = input.height
  const small = Math.min(base.maxX - base.minX, base.maxY - base.minY)
  const baseTop = h * BASE_SHARE
  const coverTop = baseTop + Math.min(COVER, h * COVER_SHARE)
  const cover = grown(base, -Math.min(COVER_INSET, small * COVER_INSET_SHARE))
  const [cx, cy] = [(base.minX + base.maxX) / 2, (base.minY + base.maxY) / 2]
  const button = prism(circle(cx, cy, Math.min(BUTTON, small * BUTTON_SHARE), BUTTON_SIDES), coverTop, h, { top: look.top ?? look.body, side: look.body }, "matt", "pin")
  const surface = input.parsed?.params["smd"] === true
  const spec = surface ? WING : STRIP
  const fold: FoldSpec = { ...spec, thick: Math.min(spec.thick, h * THICK_SHARE), rise: Math.min(spec.rise, baseTop * RISE_SHARE) }
  const pieces: Piece[] = [
    ...box(base, 0, baseTop, look.body, "matt", "body"),
    ...box(cover, baseTop, coverTop, look.metal, "metal", "cap"),
    ...button,
  ]
  for (const pad of input.pads) pieces.push(...foldedTerminal(pad, base, fold, look.metal))
  return surface ? pieces : [...pieces, ...leads(input, look.metal, PIN_HALF)]
}
