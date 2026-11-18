// A screw terminal block: a green block on the footprint's body outline, a slotted round screw head on top over every pin,
// a dark wire opening on the front face (−y) of every pole, a square pin through each hole. Pure.
import { leads, type ShapeInput } from "./input.js"
import { box, clipped, facet, grown, lathe, type Piece, type Rect } from "./kit.js"

/** The screw heads stand this far above the block, and the slot this far above the head's top. */
const HEAD_HEIGHT = 0.6
const SLOT_RISE = 0.04
const HEAD_SIDES = 12
/** A head's radius as a share of the pole's pitch. */
const HEAD_SHARE = 0.32
/** The slot's half length (share of the head's radius) and half width. */
const SLOT_LENGTH = 0.8
const SLOT_HALF = 0.2
/** The wire opening: its width as a share of the pitch, and from where to where on the front, as shares of the block's height. */
const OPENING_SHARE = 0.6
const OPENING_FROM = 0.18
const OPENING_TO = 0.62
/** The block's front is set back from the outline by this much, so the openings stand in front of it. */
const SET_BACK = 0.03
const INSET = 0.15
/** A pin's half size. */
const PIN_HALF = { x: 0.45, y: 0.45 }

const DEFAULT_PITCH = 5.08
const MIN_PITCH = 0.5

/** The pitch from the pads: the nearest two along the row. */
function pitchOf(xs: readonly number[]): number {
  const sorted = [...xs].sort((a, b) => a - b)
  const gaps = sorted.slice(1).map((x, i) => x - (sorted[i] as number)).filter((gap) => gap > MIN_PITCH)
  return gaps.length === 0 ? DEFAULT_PITCH : Math.min(...gaps)
}

/** The dark opening on the block's front face, centred on a pole. */
function opening(x: number, y: number, width: number, z0: number, z1: number, color: ShapeInput["look"]["mark"]): Piece {
  return facet([[x - width / 2, y, z0], [x + width / 2, y, z0], [x + width / 2, y, z1], [x - width / 2, y, z1]], [0, -1, 0], color, "matt", "body")
}

export function screwShape(input: ShapeInput): Piece[] {
  const outline: Rect = clipped(input.body ?? grown(input.limit, -INSET), input.limit)
  const { look } = input
  const h = input.height
  const top = h - Math.min(HEAD_HEIGHT, h * 0.1)
  const pitch = pitchOf(input.pads.map((pad) => pad.x))
  const radius = pitch * HEAD_SHARE
  const pieces: Piece[] = [...box({ ...outline, minY: outline.minY + SET_BACK }, 0, top, look.body, "matt", "body")]
  for (const pad of input.pads) {
    pieces.push(...lathe([[radius, top], [radius, h - SLOT_RISE]], pad.x, pad.y, HEAD_SIDES, look.metal, "metal", "cap"))
    const slot = { minX: pad.x - radius * SLOT_LENGTH, maxX: pad.x + radius * SLOT_LENGTH, minY: pad.y - SLOT_HALF, maxY: pad.y + SLOT_HALF }
    pieces.push(...box(slot, h - SLOT_RISE, h, look.mark, "matt", "cap"))
    pieces.push(opening(pad.x, outline.minY, pitch * OPENING_SHARE, top * OPENING_FROM, top * OPENING_TO, look.mark))
  }
  return [...pieces, ...leads(input, look.metal, PIN_HALF)]
}
