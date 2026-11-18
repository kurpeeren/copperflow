// A surface-mount PLCC LED (3528, 5050): a white body with a round pale lens on top, a tinned terminal at each pad, and a
// clipped corner at pad 1 on the four- and six-pad parts; the two-pad one has a green bar on top at the cathode, pad 2. Pure.
import { clipPieces } from "./chip.js"
import { firstPad, padsRect, type ShapeInput } from "./input.js"
import { box, clipped, grown, lathe, prism, type Piece } from "./kit.js"
import { clippedCorner, terminal } from "./smd.js"

/** The body stands this far off the board and takes this share of the height; the lens rises from there. */
const STANDOFF = 0.04
const BODY_SHARE = 0.78
/** The lens is this share of the body's short side across, and a dome of this many steps up to this angle. */
const LENS_SHARE = 0.36
const SIDES = 16
const DOME_STEPS = 4
const DOME_ANGLE = Math.PI / 3
/** A corner is clipped by this share of the body's short side, and a terminal reaches this far under and out, mm. */
const CLIP_SHARE = 0.12
const INSIDE = 0.25
const OUTSIDE = 0.2
const TERMINAL_HEIGHT = 0.3

/** The lens: a low dome over the body's middle, flat on top, rising from `from` to `to`. */
function lens(cx: number, cy: number, radius: number, from: number, to: number, color: ShapeInput["look"]["body"]): Piece[] {
  const profile = Array.from({ length: DOME_STEPS + 1 }, (_, i): [number, number] => {
    const angle = (DOME_ANGLE * i) / DOME_STEPS
    return [radius * Math.cos(angle), from + ((to - from) * Math.sin(angle)) / Math.sin(DOME_ANGLE)]
  })
  return lathe(profile, cx, cy, SIDES, color, "matt", "body")
}

export function ledSmdShape(input: ShapeInput): Piece[] {
  const reach = padsRect(input.pads)
  const body = clipped(input.body ?? (reach ? grown(reach, -0.1) : input.limit), input.limit)
  const [width, depth] = [body.maxX - body.minX, body.maxY - body.minY]
  const h = input.height
  const shoulder = h * BODY_SHARE
  const { look } = input
  const one = firstPad(input.pads)
  const corner = input.pads.length >= 4 && one !== undefined ? clippedCorner(body, one.x < 0 ? -1 : 1, one.y < 0 ? -1 : 1, Math.min(width, depth) * CLIP_SHARE) : undefined
  const outline = corner ?? [{ x: body.minX, y: body.minY }, { x: body.maxX, y: body.minY }, { x: body.maxX, y: body.maxY }, { x: body.minX, y: body.maxY }]
  const pieces: Piece[] = [
    ...prism(outline, Math.min(STANDOFF, shoulder / 3), shoulder, look.body, "matt", "body"),
    ...lens((body.minX + body.maxX) / 2, (body.minY + body.maxY) / 2, Math.min(width, depth) * LENS_SHARE, shoulder, h, look.top ?? look.body),
  ]
  if (corner === undefined) {
    const cathode = input.pads.find((pad) => pad.number === "2")
    if (cathode !== undefined) {
      const side = cathode.x >= (body.minX + body.maxX) / 2 ? 1 : -1
      const edge = side > 0 ? body.maxX : body.minX
      pieces.push(...box({ minX: Math.min(edge - side * width * 0.06, edge - side * width * 0.16), maxX: Math.max(edge - side * width * 0.06, edge - side * width * 0.16), minY: body.minY + depth * 0.15, maxY: body.maxY - depth * 0.15 }, shoulder, Math.min(shoulder + 0.02, h), look.mark, "matt", "cathode"))
    }
  }
  for (const pad of input.pads) pieces.push(...terminal(pad, body, { inside: INSIDE, outside: OUTSIDE, height: Math.min(TERMINAL_HEIGHT, shoulder / 2) }, look.metal))
  return clipPieces(pieces, input.limit)
}
