// A square multiturn trimmer (Bourns 3296W): a blue moulded body standing on small feet, its top edges chamfered, the
// brass adjusting screw with its slot standing up out of the top in the corner at the pin 1 end, the value printed on
// the top as makers print it (10 kΩ as "103"), and a lead down through each hole. Dimensions from the Bourns 3296 data
// sheet, p1 (common dimensions). Pure.
import { parseQuantity } from "../../../../src/engine/sim/values.js"
import { leads, type ShapeInput } from "./input.js"
import { box, clipped, frustum, grown, lathe, type Piece, type Rect } from "./kit.js"
import { lidPrint } from "./sleeve-print.js"

/** The body stands on feet this high (the data sheet's 0.38 mm minimum standoff). */
const STANDOFF = 0.38
/** The chamfer round the top. */
const CHAMFER = 0.25
/** The adjusting screw: its head 2.19 mm across standing 1.52 mm out of the top, its centre 1.27 mm in from the pin 1
 * end and 1.27 mm in from one long side. */
const SCREW_DIAMETER = 2.19
const SCREW_RISE = 1.52
const SCREW_FROM_END = 1.27
const SCREW_FROM_SIDE = 1.27
const SCREW_SIDES = 20
/** The slot across the screw: 0.56 mm wide (the data sheet's slot), as long as the head less a rim. */
const SLOT_WIDTH = 0.56
const SLOT_RIM = 0.25
/** The lead's half size in the hole (0.51 mm leads). */
const LEAD_HALF = { x: 0.255, y: 0.255 }

/** A resistance as its three-digit code: two significant digits and the number of zeros, "103" for 10 kΩ. */
export function resistanceCode(value: unknown): string | undefined {
  const ohms = parseQuantity(value)
  if (ohms === undefined || !(ohms >= 10)) return undefined
  const zeros = Math.floor(Math.log10(ohms)) - 1
  const digits = Math.round(ohms / 10 ** zeros)
  return digits >= 100 ? `${Math.round(digits / 10)}${zeros + 1}` : `${digits}${zeros}`
}

export function trimmerShape(input: ShapeInput): Piece[] {
  const body: Rect = clipped(input.body ?? grown(input.limit, -0.2), input.limit)
  const { look } = input
  const top = input.height - SCREW_RISE
  const pieces: Piece[] = [
    ...box(body, STANDOFF, top - CHAMFER, look.body, "matt", "body").slice(1),
    ...frustum(body, grown(body, -CHAMFER), top - CHAMFER, top, look.body, "matt", "body"),
  ]
  // The screw sits at the pin 1 end (the pad numbered 1 is at the low x of the footprint).
  const one = input.pads.find((pad) => pad.number === "1")
  const atLow = one === undefined || one.x <= (body.minX + body.maxX) / 2
  const cx = atLow ? body.minX + SCREW_FROM_END : body.maxX - SCREW_FROM_END
  const cy = body.minY + SCREW_FROM_SIDE
  const r = SCREW_DIAMETER / 2
  pieces.push(...lathe([[r, top], [r, input.height - 0.01]], cx, cy, SCREW_SIDES, look.metal, "metal", "cap"))
  const slot = { minX: cx - (r - SLOT_RIM), maxX: cx + (r - SLOT_RIM), minY: cy - SLOT_WIDTH / 2, maxY: cy + SLOT_WIDTH / 2 }
  // The lathe gives the head a flat top at the part's height; the slot lies on it, the last hundredth of a mm.
  pieces.push(...box(slot, input.height - 0.01, input.height, look.top ?? look.body, "matt", "cap"))
  const code = resistanceCode(input.props?.["maxResistance"] ?? input.props?.["resistance"])
  if (code !== undefined) {
    const free = atLow ? { from: cx + r + 0.4, to: body.maxX - CHAMFER - 0.3 } : { from: body.minX + CHAMFER + 0.3, to: cx - r - 0.4 }
    const along = free.to - free.from
    const across = body.maxY - body.minY - 2 * CHAMFER - 0.6
    pieces.push(...lidPrint({ x: (free.from + free.to) / 2, y: (body.minY + body.maxY) / 2 }, along, across, top, [code], look.mark, false))
  }
  return [...pieces, ...leads(input, look.metal, LEAD_HALF)]
}
