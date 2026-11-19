// A DIP as moulded: a dark body raised off the board, its two halves leaning in from the parting line (the mould's
// draft), a half-round notch and a dot at the pin 1 end. Each leg leaves the body at the parting line as a flat
// shoulder, turns down as a wide flat strip, narrows at the knee where it stops on the board's side of the hole, and
// goes on through the hole as a narrow lead below it. Pure.
import { pin1Dot } from "./gullwing.js"
import { firstPad, leads, type ShapeInput } from "./input.js"
import { box, clipped, frustum, grown, lying, prism, type Flat, type Piece, type Rect } from "./kit.js"
import type { Pad } from "../../../../src/engine/footprints/types.js"

/** The body stands this far off the board. */
const STANDOFF = 0.6
/** A leg's thickness, its width along the row above the knee, and below it (JEDEC MS-001: c, b2, b). */
const LEG_THICKNESS = 0.25
const LEG_WIDE = 1.52
const LEG_NARROW = 0.46
/** The knee: where the wide strip ends, and the height over which it narrows. */
const KNEE = 0.8
const KNEE_TAPER = 0.35
/** The parting line, where the legs leave the body: this share of the way up the body. */
const PARTING_SHARE = 0.4
/** How far each half of the body leans in over its height: the upper half more than the lower. */
const DRAFT_TOP = 0.25
const DRAFT_BOTTOM = 0.1
/** The notch is a half disc this wide at most, or this share of the body's width. */
const NOTCH_RADIUS = 0.9
const NOTCH_SHARE = 0.18
const NOTCH_STEPS = 12

/** A half disc at the middle of one end of the body, cut into it: `end` is +1 at the top (+y) end, −1 at the bottom. */
function notch(body: Rect, end: 1 | -1, radius: number): Flat[] {
  const cx = (body.minX + body.maxX) / 2
  const y = end === 1 ? body.maxY : body.minY
  const arc = Array.from({ length: NOTCH_STEPS + 1 }, (_, i) => {
    const angle = Math.PI * (i / NOTCH_STEPS) + (end === 1 ? Math.PI : 0)
    return { x: cx + radius * Math.cos(angle), y: y + radius * Math.sin(angle) }
  })
  return arc
}

/** A rectangle along the row (y) at `y`, `width` wide, as a polygon in the y–z plane from z0 to z1. */
const band = (y: number, width: number, z0: number, z1: number): Flat[] => [
  { x: y - width / 2, y: z0 },
  { x: y + width / 2, y: z0 },
  { x: y + width / 2, y: z1 },
  { x: y - width / 2, y: z1 },
]

/** One leg: out of the body's side at the shoulder, down as a wide strip to the knee, then narrow to the board. */
function leg(pad: Pad, body: Rect, shoulder: number, color: ShapeInput["look"]["metal"]): Piece[] {
  const sign = pad.x >= (body.minX + body.maxX) / 2 ? 1 : -1
  const edge = sign === 1 ? body.maxX : body.minX
  const outer = pad.x + sign * (LEG_THICKNESS / 2)
  const [lo, hi] = [Math.min(edge, outer), Math.max(edge, outer)]
  const across = { minY: pad.y - LEG_WIDE / 2, maxY: pad.y + LEG_WIDE / 2 }
  const stub = box({ minX: lo, maxX: hi, ...across }, shoulder, shoulder + LEG_THICKNESS, color, "metal", "leg")
  const [x0, x1] = [pad.x - LEG_THICKNESS / 2, pad.x + LEG_THICKNESS / 2]
  const taper: Flat[] = [
    { x: pad.y - LEG_NARROW / 2, y: KNEE - KNEE_TAPER },
    { x: pad.y + LEG_NARROW / 2, y: KNEE - KNEE_TAPER },
    { x: pad.y + LEG_WIDE / 2, y: KNEE },
    { x: pad.y - LEG_WIDE / 2, y: KNEE },
  ]
  return [
    ...stub,
    ...lying(band(pad.y, LEG_WIDE, KNEE, shoulder + LEG_THICKNESS), x0, x1, color, "metal", "leg"),
    ...lying(taper, x0, x1, color, "metal", "leg"),
    ...lying(band(pad.y, LEG_NARROW, 0, KNEE - KNEE_TAPER), x0, x1, color, "metal", "leg"),
  ]
}

export function dipShape(input: ShapeInput): Piece[] {
  const body = clipped(input.body ?? grown(input.limit, -0.3), input.limit)
  const { look } = input
  const h = input.height
  const top = h - 0.02
  const parting = STANDOFF + (top - STANDOFF) * PARTING_SHARE
  const upper = grown(body, -DRAFT_TOP)
  const pieces: Piece[] = [
    ...frustum(grown(body, -DRAFT_BOTTOM), body, STANDOFF, parting, look.body, "matt", "body", true),
    ...frustum(body, upper, parting, top, look.body, "matt", "body"),
  ]
  for (const pad of input.pads) if (pad.layers === "through") pieces.push(...leg(pad, body, parting - LEG_THICKNESS / 2, look.metal))
  const one = firstPad(input.pads)
  const end = one !== undefined && one.y < (body.minY + body.maxY) / 2 ? -1 : 1
  const radius = Math.min(NOTCH_RADIUS, (upper.maxX - upper.minX) * NOTCH_SHARE)
  pieces.push(...prism(notch(upper, end, radius), top - 0.01, h, look.mark, "matt", "pin1"))
  pieces.push(...pin1Dot(input, upper, top))
  return [...pieces, ...leads(input, look.metal, { x: LEG_THICKNESS / 2, y: LEG_NARROW / 2 })]
}
