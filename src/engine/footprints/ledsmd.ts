import type { Point } from "../model.js"
import { cathodeBar, closedRectangle, courtyard } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { clearOutline, FIXED_LAND_COURTYARD, isBare, pairPads, rowPads, tickBelow } from "./smdbox.js"
import type { Footprint, Pad } from "./types.js"

/**
 * Surface-mount PLCC LEDs, written from general knowledge of LED makers' drawings (3528 and 5050
 * PLCC packages), not transcribed from one drawing:
 * - led3528 (PLCC-2): body 3.5 × 2.8, two pads 1.2 × 2.4 at ±1.55; pad 1 anode, pad 2 cathode,
 *   marked by a bar on the pad 2 side as the diodes are;
 * - led5050 (PLCC-4): body 5.0 × 5.0, pads 1.0 × 1.6 at x ±1.65, y ±2.4;
 * - led5050_6 (PLCC-6): body 5.0 × 5.0, pads 1.0 × 1.6 at x −1.6, 0, 1.6 and y ±2.4.
 * Pads are numbered counter-clockwise from the bottom left; pin functions differ between parts
 * (RGB, single colour, addressable), so a part's own sheet should confirm them.
 */
const BODY_3528 = { x: 1.75, y: 1.4 }
const BODY_5050 = { x: 2.5, y: 2.5 }
const PAD_5050 = { x: 1.0, y: 1.6 }
const ROW_5050 = 2.4

function plcc2(): Footprint {
  const pads = pairPads(1.55, 1.2, 2.4)
  return {
    name: "led3528",
    pads,
    courtyard: courtyard(pads, BODY_3528, FIXED_LAND_COURTYARD),
    silkscreen: [...clearOutline(closedRectangle(BODY_3528), pads), cathodeBar(pads, BODY_3528)],
    fabrication: [closedRectangle(BODY_3528)],
    origin: "Surface-mount PLCC-2 LED 3.5 × 2.8 mm (pad 1 anode): fixed land pattern, typical, not from one maker's drawing",
  }
}

function plcc5050(name: string, xs: readonly number[]): Footprint {
  const pads = rowPads(xs, ROW_5050, PAD_5050.x, PAD_5050.y)
  const body: Point[] = closedRectangle(BODY_5050)
  return {
    name,
    pads,
    courtyard: courtyard(pads, BODY_5050, FIXED_LAND_COURTYARD),
    silkscreen: [...clearOutline(body, pads), tickBelow(pads, pads[0] as Pad)],
    fabrication: [body],
    origin: `Surface-mount PLCC-${pads.length} LED 5.0 × 5.0 mm: fixed land pattern, typical, not from one maker's drawing`,
  }
}

export function ledSmdFootprint(parsed: ParsedFootprint): Footprint | undefined {
  if (parsed.kind !== "led") return undefined
  if (parsed.code === "3528" && isBare(parsed)) return plcc2()
  if (parsed.code !== "5050") return undefined
  if (isBare(parsed)) return plcc5050("led5050", [-1.65, 1.65])
  const six = parsed.variant === "6" && parsed.cross === undefined && parsed.suffix === undefined && parsed.size === undefined && Object.keys(parsed.params).length === 0
  return six ? plcc5050("led5050_6", [-1.6, 0, 1.6]) : undefined
}
