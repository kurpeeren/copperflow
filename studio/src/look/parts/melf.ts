// A MELF diode (MiniMELF, MELF): a glass or dark cylinder lying on the board between two metal end caps, a pale band
// round it next to the cap at the cathode, pad 2. The cylinder is as high as it is wide. Pure.
import type { Flat, Piece } from "./kit.js"
import { lying } from "./kit.js"
import type { ShapeInput } from "./input.js"
import { settle, twoPads } from "./smd.js"

/** The cylinder is this many flat strips round. */
const SIDES = 16
/** The share of the length each cap takes, and its least length, mm. */
const CAP_SHARE = 0.14
const CAP_LEAST = 0.3
/** The glass is a little thinner than the caps; the band a little thicker than the glass. */
const GLASS_SHARE = 0.93
const BAND_SHARE = 0.96
/** The cylinder takes at most this share of the courtyard's room across, so the band and caps stay inside it. */
const ROOM_SHARE = 0.95

/** A regular polygon in the y-z plane for a cylinder of `radius` whose axis is `axisHeight` above the board. */
function round(radius: number, axisHeight: number): Flat[] {
  return Array.from({ length: SIDES }, (_, i) => ({ x: radius * Math.cos((2 * Math.PI * i) / SIDES), y: axisHeight + radius * Math.sin((2 * Math.PI * i) / SIDES) }))
}

export function melfShape(input: ShapeInput): Piece[] {
  const axis = twoPads(input)
  if (axis === undefined) return []
  // As high as wide, but never wider than the courtyard allows across the pads' axis.
  const flat = Math.abs(Math.sin((axis.angle * Math.PI) / 180)) > 0.7
  const room = flat ? Math.min(input.limit.maxX - axis.mid.x, axis.mid.x - input.limit.minX) : Math.min(input.limit.maxY - axis.mid.y, axis.mid.y - input.limit.minY)
  const radius = Math.min(input.height / 2, room * ROOM_SHARE)
  const half = axis.bodyAlong / 2
  const cap = Math.max(axis.bodyAlong * CAP_SHARE, CAP_LEAST)
  const band = Math.max(axis.bodyAlong * 0.14, 0.3)
  const { look } = input
  const pieces: Piece[] = [
    ...lying(round(radius, radius), -half, -half + cap, look.metal, "metal", "cap"),
    ...lying(round(radius, radius), half - cap, half, look.metal, "metal", "cap"),
    ...lying(round(radius * GLASS_SHARE, radius), -half + cap, half - cap, look.body, "matt", "body"),
    ...lying(round(radius * BAND_SHARE, radius), half - cap - band, half - cap, look.mark, "matt", "cathode"),
  ]
  return settle(pieces, axis, input)
}
