import { closedRectangle, courtyard } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { clearOutline, FIXED_LAND_COURTYARD, isBare, pairPads, rowPads, tickBelow } from "./smdbox.js"
import type { Footprint, Pad } from "./types.js"

/**
 * Surface-mount crystals and oscillators. Four-pad packages are numbered counter-clockwise from the
 * bottom left (seen from the top). For xtal3225 the maker's sheet read below (Abracon ABM8) puts the
 * crystal across pads 1 and 3 and marks pads 2 and 4 GND (the lid). For xtal2016, xtal2520 and
 * xtal5032 that is taken as the usual arrangement of four-pad crystals; no sheet for them was read,
 * so a part's own sheet should confirm it. On the xtal7050 oscillator the pads are, as is usual for such oscillators, 1 enable,
 * 2 ground, 3 output, 4 supply; check the part's own sheet.
 */
interface Xtal {
  label: string
  body: { x: number; y: number }
  /** Pad size along x and y. */
  pad: { x: number; y: number }
  /** Pad centres: ±x, and ±y for four pads (y 0 means two pads). */
  centre: { x: number; y: number }
  cited: boolean
}

/**
 * Cited: Abracon, "ABM8 Ceramic SMD Crystal" data sheet, revised 07-29-20, page 2 ("Outline
 * drawing"): body 3.2 ± 0.20 × 2.5 ± 0.20; recommended land pattern pads 1.3 (x) × 1.05 (y), 1.0
 * apart along x and 0.7 apart along y, so centres ±1.15 and ±0.875; top view pins 1 bottom left,
 * 2 bottom right, 3 top right, 4 top left, pins 2 and 4 marked GND.
 * https://abracon.com/Resonators/abm8.pdf
 */
const XTAL3225: Xtal = { label: "3.2 × 2.5 mm crystal (Abracon ABM8 land pattern)", body: { x: 1.6, y: 1.25 }, pad: { x: 1.3, y: 1.05 }, centre: { x: 1.15, y: 0.875 }, cited: true }

/**
 * Typical: written from general knowledge of crystal and oscillator makers' drawings (Epson, NDK,
 * Abracon families of these sizes), not transcribed from one drawing.
 * - 2016: body 2.0 × 1.6, pads 0.7 × 0.6 at ±0.7, ±0.5;
 * - 2520: body 2.5 × 2.0, pads 0.9 × 0.8 at ±0.85, ±0.65;
 * - 5032 four-pad: body 5.0 × 3.2, pads 1.6 × 1.4 at ±1.85, ±1.1;
 * - 5032 two-pad: body 5.0 × 3.2, pads 2.0 × 2.4 at ±1.85;
 * - 3215 (32.768 kHz tuning fork): body 3.2 × 1.5, pads 1.0 × 1.8 at ±1.25;
 * - 7050 oscillator: body 7.0 × 5.0, pads 1.8 × 2.0 at ±2.54, ±1.4;
 * - HC-49/US SMD: body 11.4 × 4.7 (the metal can on its plastic seat), pads 5.5 × 2.0 at ±4.75.
 */
const TYPICAL = new Map<string, Xtal>([
  ["xtal2016", { label: "2.0 × 1.6 mm crystal", body: { x: 1.0, y: 0.8 }, pad: { x: 0.7, y: 0.6 }, centre: { x: 0.7, y: 0.5 }, cited: false }],
  ["xtal2520", { label: "2.5 × 2.0 mm crystal", body: { x: 1.25, y: 1.0 }, pad: { x: 0.9, y: 0.8 }, centre: { x: 0.85, y: 0.65 }, cited: false }],
  ["xtal5032", { label: "5.0 × 3.2 mm crystal, four pads", body: { x: 2.5, y: 1.6 }, pad: { x: 1.6, y: 1.4 }, centre: { x: 1.85, y: 1.1 }, cited: false }],
  ["xtal5032_2", { label: "5.0 × 3.2 mm crystal, two pads", body: { x: 2.5, y: 1.6 }, pad: { x: 2.0, y: 2.4 }, centre: { x: 1.85, y: 0 }, cited: false }],
  ["xtal3215", { label: "3.2 × 1.5 mm 32.768 kHz crystal", body: { x: 1.6, y: 0.75 }, pad: { x: 1.0, y: 1.8 }, centre: { x: 1.25, y: 0 }, cited: false }],
  ["xtal7050", { label: "7.0 × 5.0 mm oscillator", body: { x: 3.5, y: 2.5 }, pad: { x: 1.8, y: 2.0 }, centre: { x: 2.54, y: 1.4 }, cited: false }],
  ["hc49smd", { label: "HC-49/US SMD crystal", body: { x: 5.7, y: 2.35 }, pad: { x: 5.5, y: 2.0 }, centre: { x: 4.75, y: 0 }, cited: false }],
])

const XTALS = new Map<string, Xtal>([["xtal3225", XTAL3225], ...TYPICAL])

function keyOf(parsed: ParsedFootprint): string | undefined {
  if (parsed.kind === "hc" && parsed.code === "49" && parsed.suffix === "smd") {
    return parsed.cross === undefined && parsed.variant === undefined && parsed.size === undefined && Object.keys(parsed.params).length === 0 ? "hc49smd" : undefined
  }
  if (parsed.kind !== "xtal") return undefined
  if (parsed.variant === "2" && Object.keys(parsed.params).length === 0 && parsed.cross === undefined && parsed.suffix === undefined && parsed.size === undefined) return `xtal${parsed.code}_2`
  return isBare(parsed) ? `xtal${parsed.code}` : undefined
}

/** A surface-mount crystal or oscillator from the table above, or undefined. */
export function xtalFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const key = keyOf(parsed)
  const xtal = key === undefined ? undefined : XTALS.get(key)
  if (!key || !xtal) return undefined
  const pads: Pad[] = xtal.centre.y === 0
    ? pairPads(xtal.centre.x, xtal.pad.x, xtal.pad.y)
    : rowPads([-xtal.centre.x, xtal.centre.x], xtal.centre.y, xtal.pad.x, xtal.pad.y)
  const body = closedRectangle(xtal.body)
  return {
    name: key,
    pads,
    courtyard: courtyard(pads, xtal.body, FIXED_LAND_COURTYARD),
    silkscreen: [...clearOutline(body, pads), tickBelow(pads, pads[0] as Pad)],
    fabrication: [body],
    origin: `Surface-mount ${xtal.label}: fixed land pattern, ${xtal.cited ? "from the maker's recommended land pattern" : "typical, not from one maker's drawing"}`,
  }
}
