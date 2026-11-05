import { centredOffsets, closedRectangle, padExtent, rectangle, SILK_CLEARANCE, tidy } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/**
 * Engine plan (Task 4 decisions): a pin row is a fixed through-hole pattern, not an IPC-7351B
 * calculation. Drill 1.0 mm, pad 1.7 mm, pad 1 square and the others round, 2.54 mm pitch unless
 * `_p` says otherwise.
 */
const DRILL = 1.0
const PAD_SIZE = 1.7
export const PIN_ROW_DEFAULT_PITCH = 2.54

/**
 * Engine plan: without an IPC table, the courtyard is the pads' bounds plus 0.25 mm (the plan's rule
 * for courtyards, as for footprint files that give none).
 */
const COURTYARD_EXCESS = 0.25

/** Only guards against runaway strings such as "pinrow99999999"; it is not a part limit. */
const MAX_PINS = 1000

const mm = (value: number) => String(tidy(value))

/** The footprint string for a row of `count` pins at `pitch` mm, such as "pinrow2_p2.54mm". */
export function pinRowName(count: number, pitch: number): string {
  return `pinrow${count}_p${mm(pitch)}mm`
}

function pinPad(number: number, x: number): Pad {
  return {
    number: String(number),
    shape: number === 1 ? "rect" : "circle",
    x,
    y: 0,
    width: PAD_SIZE,
    height: PAD_SIZE,
    rotation: 0,
    layers: "through",
    drill: { width: DRILL, height: DRILL },
  }
}

/**
 * "pinrow<N>" with an optional `_p<pitch>`: N through-hole pads along x, centred on the origin, or
 * undefined. A pitch at or below the pad size is refused, because the pads would touch. The body is
 * not drawn: its size is not part of the string.
 */
export function pinRowFootprint(parsed: ParsedFootprint): Footprint | undefined {
  if (parsed.kind !== "pinrow" || parsed.variant !== undefined) return undefined
  if (Object.keys(parsed.params).some((key) => key !== "p")) return undefined
  const count = Number(parsed.code)
  const pitch = parsed.params["p"] ?? PIN_ROW_DEFAULT_PITCH
  if (!Number.isInteger(count) || count < 1 || count > MAX_PINS || pitch === true || pitch <= PAD_SIZE) return undefined
  const pads = centredOffsets(count, pitch).map((x, i) => pinPad(i + 1, x))
  const extent = padExtent(pads)
  const around = (gap: number) => ({ x: tidy(extent.x + gap), y: tidy(extent.y + gap) })
  return {
    name: pinRowName(count, pitch),
    pads,
    courtyard: rectangle(around(COURTYARD_EXCESS)),
    silkscreen: [closedRectangle(around(SILK_CLEARANCE))],
    fabrication: [],
    origin: `Fixed pin row, not an IPC-7351B calculation: ${mm(pitch)} mm pitch, ${DRILL.toFixed(1)} mm drill, ${PAD_SIZE.toFixed(1)} mm pads`,
  }
}
