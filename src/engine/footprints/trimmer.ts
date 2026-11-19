import { mm } from "./exposed.js"
import { range } from "./ic.js"
import { leadDiameter, THROUGH_HOLE_COURTYARD, throughHoleLand, throughHolePad } from "./ipc7251.js"
import { courtyard, SILK_CLEARANCE, tidy } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/**
 * Cited: Bourns, "3296 - 3/8" Square Trimpot Trimming Potentiometer" data sheet, REV. 02/26, page 1 (Product
 * Dimensions, common dimensions and 3296W): body 9.53 x 4.83 mm and 10.03 mm high, the adjusting screw 1.52 mm above
 * that in the corner at the pin 1 end; three leads 0.51 ± 0.03 mm across,
 * 2.54 mm apart in one row, the row 2.41 mm in from one long side (so it runs down the body's middle) and the leads
 * drawn centred along it; pin 1 counter-clockwise end, 2 wiper, 3 clockwise end; the adjusting screw on top.
 * https://www.bourns.com/docs/Product-Datasheets/3296.pdf
 */
const BODY = { x: 9.53, y: 4.83 }
const PITCH = 2.54
const LEAD = range(0.48, 0.54)
export const TRIMMER_3296_DOCUMENT = "Bourns 3296 data sheet REV. 02/26, p1, Product Dimensions (3296W)"

/** The tick that marks pin 1: from the outline in towards pin 1, this long. */
const TICK = 0.6

/** "trimmer3296w": the Bourns 3296W top-adjust trimmer, pin 1 at the left, the wiper in the middle; or undefined. */
export function trimmerFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const plain = parsed.size === undefined && parsed.pairs === undefined && parsed.variant === undefined && parsed.cross === undefined
  if (parsed.kind !== "trimmer" || parsed.code !== "3296" || parsed.suffix !== "w" || !plain || Object.keys(parsed.params).length > 0) return undefined
  const land = throughHoleLand(leadDiameter(LEAD))
  const pads: Pad[] = ["1", "2", "3"].map((number, i) => throughHolePad(number, tidy((i - 1) * PITCH), 0, land, i === 0))
  const half = { x: BODY.x / 2, y: BODY.y / 2 }
  const body = [
    { x: -half.x, y: -half.y },
    { x: half.x, y: -half.y },
    { x: half.x, y: half.y },
    { x: -half.x, y: half.y },
    { x: -half.x, y: -half.y },
  ]
  const outer = { x: tidy(half.x + SILK_CLEARANCE), y: tidy(half.y + SILK_CLEARANCE) }
  const silk = [
    { x: -outer.x, y: -outer.y },
    { x: outer.x, y: -outer.y },
    { x: outer.x, y: outer.y },
    { x: -outer.x, y: outer.y },
    { x: -outer.x, y: -outer.y },
  ]
  const pin1 = pads[0] as Pad
  const tick = [
    { x: pin1.x, y: -outer.y },
    { x: pin1.x, y: tidy(-outer.y + TICK) },
  ]
  return {
    name: "trimmer3296w",
    pads,
    courtyard: courtyard(pads, half, THROUGH_HOLE_COURTYARD),
    silkscreen: [silk, tick],
    fabrication: [body],
    origin: `Through-hole Bourns 3296W 3/8 in. square trimmer, top adjust: body ${mm(BODY.x)} x ${mm(BODY.y)} mm, three leads ${mm(PITCH)} mm apart (${TRIMMER_3296_DOCUMENT}); ${land.drill} mm holes, ${land.pad} mm lands (IPC-2222 level B)`,
  }
}
