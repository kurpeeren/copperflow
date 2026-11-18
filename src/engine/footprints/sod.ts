import { GULL_WING_TABLE, gullWingGoals, IPC_TOLERANCES, landPattern, twoTerminalPads, type Range } from "./ipc7351.js"
import { bodyOutline, cathodeBar, courtyard, sideLines } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import type { Footprint } from "./types.js"

/** A small outline diode: toe-to-toe span He, lead foot length L, lead width b, body E × D. */
interface SodOutline {
  label: string
  span: Range
  terminal: Range
  leadWidth: Range
  bodyLength: Range
  bodyWidth: Range
}

const range = (min: number, max: number): Range => ({ min, max })

/**
 * Diodes Incorporated package information, table "Package Outline Dimensions" on page 1 of each:
 * - "SOD123 Package Information", Rev. 2017-03-16, https://www.diodes.com/assets/Package-Files/SOD123.pdf
 * - "SOD323 Package Information", Rev. 2017-03-16, https://www.diodes.com/assets/Package-Files/SOD323.pdf
 * He is the span, L the lead foot, b the lead width, E the body length and D the body width (min–max).
 * Both have gull-wing leads, so IPC-7351B Table 3-2 applies.
 *
 * SOD-523: NXP Semiconductors, "SOD523 package information", 8 February 2016, page 2, Figure 1
 * dimension table (SC-79): HE 1.55–1.65, bp 0.26–0.34, D 1.15–1.25 (body length), E 0.75–0.85 (body
 * width). The drawing gives no foot length; the foot is taken as the part of the lead outside the body,
 * (HE − D)/2 = 0.15–0.25 from those cited values.
 *
 * SOD-923, SOD-123F and SOD-128 are written from general knowledge of makers' drawings (onsemi,
 * Nexperia, Diodes Inc.), not transcribed from one drawing:
 * - SOD-923: HE 0.95–1.05, foot 0.05–0.15, lead width 0.15–0.25, body 0.75–0.85 × 0.55–0.65.
 * - SOD-123F: HE 3.4–3.8, foot 0.45–0.75, lead width 0.7–0.9, body 2.5–2.8 × 1.5–1.8.
 * - SOD-128: HE 4.4–5.0, foot 0.6–1.0, lead width 1.5–1.9, body 3.6–4.0 × 2.3–2.7.
 *
 * SOD-523, SOD-923, SOD-123F and SOD-128 have flat leads, which IPC-7351B files as SODFL (section 8.13)
 * with goals in its Table 3-22. No source for that table was at hand, so they take Table 3-2 with
 * Note 1, as SOD-123 and SOD-323 do.
 */
const SODS: Readonly<Record<string, SodOutline>> = {
  "123": {
    label: "SOD-123",
    span: range(3.55, 3.85),
    terminal: range(0.25, 0.4),
    leadWidth: range(0.52, 0.62),
    bodyLength: range(2.55, 2.85),
    bodyWidth: range(1.4, 1.7),
  },
  "323": {
    label: "SOD-323",
    span: range(2.3, 2.7),
    terminal: range(0.2, 0.4),
    leadWidth: range(0.25, 0.35),
    bodyLength: range(1.6, 1.8),
    bodyWidth: range(1.2, 1.4),
  },
}

/** The packages added after "sod123" and "sod323": made through `sodFamily`; `sodFootprint(code)` keeps only the first two. */
const NEW_SODS: Readonly<Record<string, SodOutline>> = {
  "523": {
    label: "SOD-523",
    span: range(1.55, 1.65),
    terminal: range(0.15, 0.25),
    leadWidth: range(0.26, 0.34),
    bodyLength: range(1.15, 1.25),
    bodyWidth: range(0.75, 0.85),
  },
  "923": {
    label: "SOD-923",
    span: range(0.95, 1.05),
    terminal: range(0.05, 0.15),
    leadWidth: range(0.15, 0.25),
    bodyLength: range(0.75, 0.85),
    bodyWidth: range(0.55, 0.65),
  },
  "123f": {
    label: "SOD-123F",
    span: range(3.4, 3.8),
    terminal: range(0.45, 0.75),
    leadWidth: range(0.7, 0.9),
    bodyLength: range(2.5, 2.8),
    bodyWidth: range(1.5, 1.8),
  },
  "128": {
    label: "SOD-128",
    span: range(4.4, 5.0),
    terminal: range(0.6, 1.0),
    leadWidth: range(1.5, 1.9),
    bodyLength: range(3.6, 4.0),
    bodyWidth: range(2.3, 2.7),
  },
}

/**
 * The family function for registration: "sod123", "sod323", "sod523", "sod923", "sod123f", "sod128"
 * as parsed strings, with no variant, size or parameters; undefined otherwise.
 */
export function sodFamily(parsed: ParsedFootprint): Footprint | undefined {
  const plain = parsed.variant === undefined && parsed.cross === undefined && parsed.size === undefined && parsed.pairs === undefined
  if (parsed.kind !== "sod" || !plain || Object.keys(parsed.params).length > 0) return undefined
  const code = `${parsed.code}${parsed.suffix ?? ""}`
  return Object.hasOwn(NEW_SODS, code) ? sodOf(code, NEW_SODS[code] as SodOutline) : sodFootprint(code)
}

/**
 * The IPC-7351B nominal footprint for "sod" + code, such as "123", or undefined. Pin 1 is the anode
 * and pin 2 the cathode, so the silkscreen cathode bar sits on the pad 2 side, at positive x.
 * Amax for Table 3-2 Note 1 is the body length between the two leads; see `gullWingGoals` for how
 * that reading was settled.
 */
export function sodFootprint(code: string): Footprint | undefined {
  return Object.hasOwn(SODS, code) ? sodOf(code, SODS[code] as SodOutline) : undefined
}

function sodOf(code: string, sod: SodOutline): Footprint {
  const lead = { span: sod.span, terminal: sod.terminal, width: sod.leadWidth }
  const goals = gullWingGoals(lead, sod.bodyLength.max)
  const pads = twoTerminalPads(landPattern(lead, goals, IPC_TOLERANCES), GULL_WING_TABLE.roundOff)
  const body = { x: sod.bodyLength.max / 2, y: sod.bodyWidth.max / 2 }
  const component = {
    x: Math.max(sod.span.max, sod.bodyLength.max) / 2,
    y: Math.max(sod.bodyWidth.max, sod.leadWidth.max) / 2,
  }
  return {
    name: `sod${code}`,
    pads,
    courtyard: courtyard(pads, component, GULL_WING_TABLE),
    silkscreen: [...sideLines(pads, body), cathodeBar(pads, body)],
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, ${sod.label}`,
  }
}
