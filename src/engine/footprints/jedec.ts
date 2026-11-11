/**
 * Packages named by their pin count, body and pitch ("qfn32_5x5_p0.5", "lqfp64_10x10_p0.5",
 * "dfn8_3x3_p0.65"): the lead dimensions a JEDEC outline of that body and pitch gives, as ranges
 * that the IPC-7351B equations take.
 *
 * Where the numbers come from. The ranges below are the typical ones of JEDEC MO-220 (QFN), MO-229
 * (DFN) and MS-026 (LQFP, TQFP), written from general knowledge of those outlines, not transcribed
 * from the standards. They reproduce the NXP drawings cited in quad.ts exactly at the pitches those
 * drawings cover (0.5 mm QFN, 0.5 and 0.8 mm LQFP), so a generated "qfn32_5x5_p0.5" or
 * "lqfp64_10x10_p0.5" equals the cited "qfn32" or "qfp64"; at other pitches they are typical
 * values that a part's own drawing should confirm.
 */
import { range, type IcPackage } from "./ic.js"
import type { Range } from "./ipc7351.js"
import type { Pair } from "./parse.js"
import { isRefusal, refuse, type Refusal } from "./types.js"

/** Body tolerance of the plastic: ±0.10 mm, as the NXP QFN and LQFP drawings in quad.ts give. */
const BODY_TOLERANCE = 0.1

/** QFN and DFN terminal length L: 0.30–0.50 mm at every supported pitch (MO-220, MO-229). */
const NO_LEAD_TERMINAL = range(0.3, 0.5)

/** QFN and DFN terminal width b by pitch. */
const NO_LEAD_WIDTH = new Map<number, Range>([
  [0.4, range(0.15, 0.25)],
  [0.5, range(0.18, 0.3)],
  [0.65, range(0.25, 0.35)],
])

/** LQFP and TQFP foot length Lp: 0.45–0.75 mm (MS-026). */
const QFP_TERMINAL = range(0.45, 0.75)

/** LQFP and TQFP lead width bp by pitch (MS-026). */
const QFP_WIDTH = new Map<number, Range>([
  [0.4, range(0.13, 0.23)],
  [0.5, range(0.17, 0.27)],
  [0.65, range(0.22, 0.38)],
  [0.8, range(0.3, 0.4)],
])

/** MS-026 LQFP and TQFP: the toe-to-toe span is the body plus 2 mm. */
const QFP_LEAD_REACH = 2
/** The span tolerance: ±0.15 mm up to a 10 mm body, ±0.25 mm above (NXP SOT314-2 and SOT407-1). */
const QFP_SPAN_TOLERANCE_SMALL = 0.15
const QFP_SPAN_TOLERANCE_LARGE = 0.25
const QFP_SMALL_BODY = 10

/** Bounds that only keep a string sane; they are not part limits. */
const MAX_PINS = 1024
const MIN_BODY = 1
const MAX_BODY = 60

const SAME = 1e-9
const plusMinus = (nominal: number, tolerance: number) => range(tidy(nominal - tolerance), tidy(nominal + tolerance))
const tidy = (value: number) => Math.round(value * 1e6) / 1e6

function byPitch(table: ReadonlyMap<number, Range>, pitch: number): Range | undefined {
  for (const [key, value] of table) if (Math.abs(key - pitch) < SAME) return value
  return undefined
}

function pinCount(code: string, perSides: number, label: string): number | Refusal {
  const pins = Number(code)
  if (!Number.isInteger(pins) || pins <= 0 || pins > MAX_PINS) return refuse(`a ${label} has 1 to ${MAX_PINS} pins`)
  return pins % perSides === 0 ? pins : refuse(`a ${label} has a pin count divisible by ${perSides}`)
}

const pitches = (table: ReadonlyMap<number, Range>) => {
  const list = [...table.keys()].map(String)
  return `${list.slice(0, -1).join(", ")} or ${list[list.length - 1]} mm`
}

function checkBody(label: string, sides: readonly number[]): Refusal | undefined {
  return sides.every((side) => side >= MIN_BODY && side <= MAX_BODY) ? undefined : refuse(`a ${label} body is ${MIN_BODY} to ${MAX_BODY} mm`)
}

/**
 * Leads along one side must fit the body: `count` leads `pitch` apart, plus one lead width, stay
 * inside the side length. Whether the corner pads of two sides clear each other is checked on the
 * pads themselves (quad.ts).
 */
function checkFit(count: number, pitch: number, width: Range, side: number): Refusal | undefined {
  return (count - 1) * pitch + width.max <= side + SAME ? undefined : refuse(`${count} pins a side at ${pitch} mm do not fit a ${side} mm side`)
}

/** The first refusal of the checks, run in order. */
function firstRefusal(...checks: readonly (() => Refusal | undefined)[]): Refusal | undefined {
  for (const check of checks) {
    const refusal = check()
    if (refusal) return refusal
  }
  return undefined
}

interface SquareQuad {
  pins: number
  side: number
  width: Range
}

/** A square four-sided package (QFN, LQFP) of `pins`, or why it cannot be one. */
function squareQuad(label: string, code: string, body: Pair, pitch: number, widths: ReadonlyMap<number, Range>): SquareQuad | Refusal {
  const pins = pinCount(code, 4, label)
  if (isRefusal(pins)) return pins
  const width = byPitch(widths, pitch)
  if (!width) return refuse(`${label} pitch must be ${pitches(widths)}`)
  const [side, other] = body
  const refusal = firstRefusal(
    () => (Math.abs(side - other) > SAME ? refuse(`${label} bodies must be square`) : undefined),
    () => checkBody(label, body),
    () => checkFit(pins / 4, pitch, width, side),
  )
  return refusal ?? { pins, side, width }
}

/** A square QFN of `pins` (four sides), body side × side, or why it cannot be one. */
export function qfnPackage(code: string, body: Pair, pitch: number): IcPackage | Refusal {
  const quad = squareQuad("QFN", code, body, pitch, NO_LEAD_WIDTH)
  if (isRefusal(quad)) return quad
  const { pins, side, width } = quad
  const outline = plusMinus(side, BODY_TOLERANCE)
  return { label: `QFN-${pins} ${side}×${side} mm, ${pitch} mm pitch`, pitch, span: outline, terminal: NO_LEAD_TERMINAL, leadWidth: width, bodyAcross: outline, bodyAlong: outline }
}

/**
 * A DFN of `pins` on two sides: the body is `<across>x<along>`, across the two rows of terminals
 * (x) and along them (y). Or why it cannot be one.
 */
export function dfnPackage(code: string, body: Pair, pitch: number): IcPackage | Refusal {
  const pins = pinCount(code, 2, "DFN")
  if (isRefusal(pins)) return pins
  const width = byPitch(NO_LEAD_WIDTH, pitch)
  if (!width) return refuse(`DFN pitch must be ${pitches(NO_LEAD_WIDTH)}`)
  const [across, along] = body
  const refusal = firstRefusal(() => checkBody("DFN", body), () => checkFit(pins / 2, pitch, width, along))
  if (refusal) return refusal
  const span = plusMinus(across, BODY_TOLERANCE)
  return {
    label: `DFN-${pins} ${across}×${along} mm, ${pitch} mm pitch`,
    pitch,
    span,
    terminal: NO_LEAD_TERMINAL,
    leadWidth: width,
    bodyAcross: span,
    bodyAlong: plusMinus(along, BODY_TOLERANCE),
  }
}

/** A square LQFP (or TQFP: the same footprint) of `pins`, or why it cannot be one. */
export function qfpPackage(code: string, body: Pair, pitch: number): IcPackage | Refusal {
  const quad = squareQuad("QFP", code, body, pitch, QFP_WIDTH)
  if (isRefusal(quad)) return quad
  const { pins, side, width } = quad
  const spanTolerance = side <= QFP_SMALL_BODY + SAME ? QFP_SPAN_TOLERANCE_SMALL : QFP_SPAN_TOLERANCE_LARGE
  const outline = plusMinus(side, BODY_TOLERANCE)
  return {
    label: `LQFP-${pins} ${side}×${side} mm, ${pitch} mm pitch`,
    pitch,
    span: plusMinus(side + QFP_LEAD_REACH, spanTolerance),
    terminal: QFP_TERMINAL,
    leadWidth: width,
    bodyAcross: outline,
    bodyAlong: outline,
  }
}
