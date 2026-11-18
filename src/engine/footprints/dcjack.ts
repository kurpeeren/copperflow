import { matingArrow, slotPad } from "./connector.js"
import { closedRectangle, courtyard } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { clearOutline, FIXED_LAND_COURTYARD, isBare } from "./smdbox.js"
import { refuse, type Footprint, type Refusal } from "./types.js"

/**
 * "dcjack" (also "dcjack2.1" and "dcjack2.5", the same footprint): the common through-hole right-angle barrel jack
 * for a 5.5 mm plug, 2.0 mm centre pin (plugs with a 2.1 mm hole fit it), with three slotted terminals: 1 the centre
 * pin, 2 the sleeve, 3 the sleeve's switch contact (opens when a plug goes in). Origin at the body centre; the plug
 * enters from −y, marked on the fabrication layer by an arrow pointing into the body.
 *
 * Cited: Würth Elektronik 694106301002, "WR-DC Power Jack Right Angled, GW, THT", revision 002.000, 2025-12-19,
 * page 1, "Recommended Hole Pattern" and side view: terminal 1 a 3.2 × 0.7 slot in a 4.2 × 1.7 land, terminal 2 a
 * 2.8 × 0.7 slot in a 3.8 × 1.7 land, both across the jack's axis, terminal 3 a 0.7 × 2.8 slot in a 1.7 × 3.8 land
 * along it, 4.8 to the side of the axis; from the mating face terminal 1 13.5, terminal 3 10.55, terminal 2 7.7;
 * body 9.0 wide, 14.5 deep; centre pin ⌀2.0, plug inner ⌀2.1. The side terminal 3 is put at +x as the drawing's top
 * view shows it. https://www.we-online.com/components/products/datasheet/694106301002.pdf
 * This is that maker's part: another maker's barrel jack (CUI PJ-002A and the like) may need different slots.
 */
const BODY = { x: 4.5, y: 7.25 }
const FROM_FRONT = { pin: 13.5, sleeve: 7.7, switched: 10.55 }
const SIDE = 4.8
const ACROSS_HOLE = 0.7
const ACROSS_LAND = 1.7
const CODES = ["", "2.1", "2.5"]

export function dcJackFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (parsed.kind !== "dcjack") return undefined
  if (!CODES.includes(parsed.code) || !isBare(parsed)) return refuse("dcjack, dcjack2.1 and dcjack2.5 are one footprint (5.5 mm sleeve, 2.0/2.1 mm pin); no other")
  const y = (fromFront: number) => -BODY.y + fromFront
  const pads = [
    slotPad("1", 0, y(FROM_FRONT.pin), { x: 4.2, y: ACROSS_LAND }, { x: 3.2, y: ACROSS_HOLE }),
    slotPad("2", 0, y(FROM_FRONT.sleeve), { x: 3.8, y: ACROSS_LAND }, { x: 2.8, y: ACROSS_HOLE }),
    slotPad("3", SIDE, y(FROM_FRONT.switched), { x: ACROSS_LAND, y: 3.8 }, { x: ACROSS_HOLE, y: 2.8 }),
  ]
  const outline = closedRectangle(BODY)
  return {
    name: "dcjack",
    pads,
    courtyard: courtyard(pads, BODY, FIXED_LAND_COURTYARD),
    silkscreen: clearOutline(outline, pads),
    fabrication: [outline, ...matingArrow(-BODY.y)],
    origin: "DC barrel jack 5.5 / 2.1 mm, through-hole, slotted terminals: from Würth Elektronik 694106301002 recommended hole pattern; that maker's part, others may differ",
  }
}
