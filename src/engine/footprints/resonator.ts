import { roundRectPad } from "./ipc7351.js"
import { closedRectangle, courtyard } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { clearOutline, FIXED_LAND_COURTYARD, isBare, tickBelow } from "./smdbox.js"
import { refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/**
 * "resonator3213": a three-terminal surface-mount ceramic resonator with built-in load capacitors, 3.2 × 1.3 mm
 * (the size of Murata's CSTCE…V53, the Arduino Uno Rev3's 16 MHz resonator). Three pads in a row along x: 1 and 3
 * the resonator's ends, 2 the middle, which goes to ground.
 *
 * Typical: written from general knowledge of such parts, not from one maker's drawing (Murata's sheet could not be
 * opened while this was written): pads 0.4 (x) × 1.9 (y) at 1.2 mm pitch, body 3.2 × 1.3. A maker's part may need
 * different lands: check its sheet.
 */
const PITCH = 1.2
const PAD = { x: 0.4, y: 1.9 }
const BODY = { x: 1.6, y: 0.65 }

export function resonatorFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (parsed.kind !== "resonator") return undefined
  if (parsed.code !== "3213" || !isBare(parsed)) return refuse("the ceramic resonator is resonator3213")
  const pads: Pad[] = [-PITCH, 0, PITCH].map((x, i) => roundRectPad(String(i + 1), x, 0, PAD.x, PAD.y))
  const body = closedRectangle(BODY)
  return {
    name: "resonator3213",
    pads,
    courtyard: courtyard(pads, BODY, FIXED_LAND_COURTYARD),
    silkscreen: [...clearOutline(body, pads), tickBelow(pads, pads[0] as Pad)],
    fabrication: [body],
    origin: "Surface-mount 3.2 × 1.3 mm three-terminal ceramic resonator: fixed land pattern, typical, not from one maker's drawing",
  }
}
