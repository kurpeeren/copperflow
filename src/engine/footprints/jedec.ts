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

function pinCount(code: string, perSides: number): number | undefined {
  const pins = Number(code)
  return Number.isInteger(pins) && pins > 0 && pins <= MAX_PINS && pins % perSides === 0 ? pins : undefined
}

const saneBody = (side: number) => side >= MIN_BODY && side <= MAX_BODY

/**
 * Leads along one side must fit the body: `count` leads `pitch` apart, plus one lead width, stay
 * inside the side length. Whether the corner pads of two sides clear each other is checked on the
 * pads themselves (quad.ts).
 */
function fits(count: number, pitch: number, width: Range, side: number): boolean {
  return (count - 1) * pitch + width.max <= side + SAME
}

/** A square QFN of `pins` (four sides), body side × side, or undefined when it cannot be one. */
export function qfnPackage(code: string, body: Pair, pitch: number): IcPackage | undefined {
  const pins = pinCount(code, 4)
  const width = byPitch(NO_LEAD_WIDTH, pitch)
  const [side, other] = body
  if (pins === undefined || !width || Math.abs(side - other) > SAME || !saneBody(side)) return undefined
  if (!fits(pins / 4, pitch, width, side)) return undefined
  const outline = plusMinus(side, BODY_TOLERANCE)
  return { label: `QFN-${pins} ${side}×${side} mm, ${pitch} mm pitch`, pitch, span: outline, terminal: NO_LEAD_TERMINAL, leadWidth: width, bodyAcross: outline, bodyAlong: outline }
}

/**
 * A DFN of `pins` on two sides: the body is `<across>x<along>`, across the two rows of terminals
 * (x) and along them (y). Undefined when it cannot be one.
 */
export function dfnPackage(code: string, body: Pair, pitch: number): IcPackage | undefined {
  const pins = pinCount(code, 2)
  const width = byPitch(NO_LEAD_WIDTH, pitch)
  const [across, along] = body
  if (pins === undefined || !width || !saneBody(across) || !saneBody(along)) return undefined
  if (!fits(pins / 2, pitch, width, along)) return undefined
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

/** A square LQFP (or TQFP: the same footprint) of `pins`, or undefined when it cannot be one. */
export function qfpPackage(code: string, body: Pair, pitch: number): IcPackage | undefined {
  const pins = pinCount(code, 4)
  const width = byPitch(QFP_WIDTH, pitch)
  const [side, other] = body
  if (pins === undefined || !width || Math.abs(side - other) > SAME || !saneBody(side)) return undefined
  if (!fits(pins / 4, pitch, width, side)) return undefined
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
