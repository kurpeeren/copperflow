// A DIP: a dark body between its two rows of holes, raised a little off the board, a half-round notch and a dot at the
// pin 1 end; each leg leaves the body's side at a shoulder, runs flat down to the board and goes on through the hole
// as a flat lead below it. Pure.
import { pin1Dot } from "./gullwing.js"
import { firstPad, leads, type ShapeInput } from "./input.js"
import { box, clipped, grown, prism, type Flat, type Piece, type Rect } from "./kit.js"
import type { Pad } from "../../../../src/engine/footprints/types.js"

/** The body stands this far off the board. */
const STANDOFF = 0.5
/** A leg's thickness and its width along the row. */
const LEG_THICKNESS = 0.25
const LEG_WIDTH = 0.5
/** The shoulder where the leg leaves the body: this share of the way up the body. */
const SHOULDER_SHARE = 0.3
/** The notch is a half disc this wide at most, or this share of the body's width. */
const NOTCH_RADIUS = 0.9
const NOTCH_SHARE = 0.18
const NOTCH_STEPS = 8

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

/** One leg: out of the body's side at the shoulder, then flat down to the board at the pad. */
function leg(pad: Pad, body: Rect, shoulder: number, color: ShapeInput["look"]["metal"]): Piece[] {
  const sign = pad.x >= (body.minX + body.maxX) / 2 ? 1 : -1
  const edge = sign === 1 ? body.maxX : body.minX
  const across = { minY: pad.y - LEG_WIDTH / 2, maxY: pad.y + LEG_WIDTH / 2 }
  const outer = pad.x + sign * (LEG_THICKNESS / 2)
  const [lo, hi] = [Math.min(edge, outer), Math.max(edge, outer)]
  const stub = box({ minX: lo, maxX: hi, ...across }, shoulder, shoulder + LEG_THICKNESS, color, "metal", "leg")
  const down = box({ minX: pad.x - LEG_THICKNESS / 2, maxX: pad.x + LEG_THICKNESS / 2, ...across }, 0, shoulder + LEG_THICKNESS, color, "metal", "leg")
  return [...stub, ...down]
}

export function dipShape(input: ShapeInput): Piece[] {
  const body = clipped(input.body ?? grown(input.limit, -0.3), input.limit)
  const { look } = input
  const h = input.height
  const top = h - 0.02
  const shoulder = STANDOFF + (top - STANDOFF) * SHOULDER_SHARE
  const pieces: Piece[] = [...box(body, STANDOFF, top, look.body, "matt", "body")]
  for (const pad of input.pads) if (pad.layers === "through") pieces.push(...leg(pad, body, shoulder, look.metal))
  const one = firstPad(input.pads)
  const end = one !== undefined && one.y < (body.minY + body.maxY) / 2 ? -1 : 1
  const radius = Math.min(NOTCH_RADIUS, (body.maxX - body.minX) * NOTCH_SHARE)
  pieces.push(...prism(notch(body, end, radius), top - 0.01, h, look.mark, "matt", "pin1"))
  pieces.push(...pin1Dot(input, body, top))
  return [...pieces, ...leads(input, look.metal, { x: LEG_THICKNESS / 2, y: LEG_WIDTH / 2 })]
}
