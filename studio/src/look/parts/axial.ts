// An axial part lying a little above the board: a round body along the two holes, a wire from each end of it that runs
// out to its pad and bends down through the board. A resistor wears three or four coloured bands (fixed colours, they
// do not code its value), a diode a band at the cathode (pad 2) end, any other part is plain. Pure.
import type { Rgb } from "../scene.js"
import { leads, type ShapeInput } from "./input.js"
import { box, circle, lying, type Piece, type Rect } from "./kit.js"

/** The body is a little smaller than the bands, so a band stands proud of it. */
const BODY_SHARE = 0.94
const SIDES = 16
/** A resistor with a body at least this long wears four bands, a shorter one three. */
const FOUR_BANDS_FROM = 5
/** The fixed band colours, in order: brown, black, red, and the gold of the tolerance band. */
const BAND_COLORS: readonly Rgb[] = [[122, 66, 30], [24, 24, 26], [190, 40, 36], [204, 168, 62]]
/** Band width: this share of the body length, at least this much. */
const BAND_SHARE = 0.09
const BAND_MIN = 0.3
/** Where the first band starts, as a share of the length from the left end, and the gap before the last. */
const FIRST_BAND_SHARE = 0.17
const LAST_BAND_GAP = 0.8
/** The cathode band's width and how far it stands inside the end, as shares of the body length. */
const CATHODE_SHARE = 0.14
const CATHODE_MIN = 0.4
const CATHODE_INSET_SHARE = 0.06
const CATHODE_MAX_SHARE = 0.4
const WIRE_SHARE = 0.6
const WIRE_MAX = 0.9
/** A wire is at most this share of the body diameter across, so it never rises above the part. */
const WIRE_BODY_SHARE = 0.9

const fallback = (input: ShapeInput): Rect => input.body ?? input.limit

/** The bands must fit between this share of the length from the left end and this share from it (on the right). */
const BAND_SPAN_SHARE = 0.78
/** A band thinner than this is not drawn: a body too short for its bands gets fewer. */
const BAND_VISIBLE = 0.15
/** The width of `count` bands with their gaps, in band widths (the fourth stands apart). */
const bandSpan = (count: number): number => (count - 1) * 1.9 + 1 + (count === 4 ? LAST_BAND_GAP : 0)

/** The bands of a resistor along x, each a thin round slice a hair larger than the body, all inside the body's length. */
function resistorBands(x0: number, length: number, mid: number, axis: number, radius: number): Piece[] {
  const wanted = length >= FOUR_BANDS_FROM ? 4 : 3
  const preferred = Math.max(BAND_MIN, length * BAND_SHARE)
  const count = [wanted, 3, 2, 1].filter((n) => n <= wanted).find((n) => Math.min(preferred, (length * BAND_SPAN_SHARE) / bandSpan(n)) >= BAND_VISIBLE)
  if (count === undefined) return []
  const width = Math.min(preferred, (length * BAND_SPAN_SHARE) / bandSpan(count))
  const step = width * 1.9
  const start = x0 + length * FIRST_BAND_SHARE
  return BAND_COLORS.slice(0, count).flatMap((color, i) => {
    const from = start + i * step + (i === 3 ? width * LAST_BAND_GAP : 0)
    return lying(circle(mid, axis, radius, SIDES), from, from + width, color, "matt", "body")
  })
}

/** A diode's band, near its cathode end (+x, the end pad 2 is at). */
function cathodeBand(x1: number, length: number, mid: number, axis: number, radius: number, color: Rgb): Piece[] {
  const width = Math.min(Math.max(CATHODE_MIN, length * CATHODE_SHARE), length * CATHODE_MAX_SHARE)
  const end = x1 - length * CATHODE_INSET_SHARE
  return lying(circle(mid, axis, radius, SIDES), end - width, end, color, "matt", "cathode")
}

/** A wire from the body's end out to its pad and down to the board. */
function wire(input: ShapeInput, padX: number, padY: number, endX: number, axis: number, half: number): Piece[] {
  const [lo, hi] = [Math.min(endX, padX - half), Math.max(endX, padX + half)]
  const { look } = input
  const along = box({ minX: lo, maxX: hi, minY: padY - half, maxY: padY + half }, axis - half, axis + half, look.metal, "metal", "leg")
  const down = box({ minX: padX - half, maxX: padX + half, minY: padY - half, maxY: padY + half }, 0, axis + half, look.metal, "metal", "leg")
  return [...along, ...down]
}

export function axialShape(input: ShapeInput): Piece[] {
  const body = fallback(input)
  const { look, lookName } = input
  const length = body.maxX - body.minX
  const radius = (body.maxY - body.minY) / 2
  const axis = input.height - radius
  const mid = (body.minY + body.maxY) / 2
  const pieces: Piece[] = [...lying(circle(mid, axis, radius * BODY_SHARE, SIDES), body.minX, body.maxX, look.body, "matt", "body")]
  if (lookName === "axialResistor") pieces.push(...resistorBands(body.minX, length, mid, axis, radius))
  if (lookName === "axialDiode" || lookName === "axialGlass") pieces.push(...cathodeBand(body.maxX, length, mid, axis, radius, look.mark))
  for (const pad of input.pads) {
    if (pad.layers !== "through") continue
    const half = Math.min(WIRE_MAX, (pad.drill?.width ?? 1) * WIRE_SHARE, radius * 2 * WIRE_BODY_SHARE) / 2
    pieces.push(...wire(input, pad.x, pad.y, pad.x < (body.minX + body.maxX) / 2 ? body.minX : body.maxX, axis, half))
  }
  return [...pieces, ...leads(input)]
}
