import { confirmsPackage, gullWingRow, range, type IcPackage } from "./ic.js"
import { roundRectPad } from "./ipc7351.js"
import { bodyOutline, courtyard, rowSilkscreen, tidy } from "./outline.js"
import { isSimple, type ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/** A SOT-23 variant: its outline and where its leads sit along each row, in pitches from the centre. */
interface SotVariant {
  pkg: IcPackage
  /** Pads 1, 2, … along the bottom row, left to right. */
  bottom: readonly number[]
  /** The remaining pads along the top row, right to left. */
  top: readonly number[]
}

/**
 * NXP Semiconductors, "SOT23 package information", 9 January 2017 (JEDEC TO-236AB), dimension table
 * of the package outline: HE 2.1–2.5, Lp 0.15–0.45, bp 0.38–0.48, E 1.2–1.4, D 2.8–3.0, e1 0.95 (and
 * e 1.9 between pins 1 and 2). https://www.nxp.com/docs/en/package-information/SOT23.pdf
 */
const SOT23: SotVariant = {
  pkg: {
    label: "SOT-23",
    pitch: 0.95,
    span: range(2.1, 2.5),
    terminal: range(0.15, 0.45),
    leadWidth: range(0.38, 0.48),
    bodyAcross: range(1.2, 1.4),
    bodyAlong: range(2.8, 3.0),
  },
  bottom: [-1, 1],
  top: [0],
}

/**
 * Diodes Incorporated, "SOT25 Package Information", Rev. 2017-04-11, and "SOT26 Package Information",
 * Rev. 2021-03-02, table "Package Outline Dimensions" on page 1 of each. Both give span 2.70–3.00
 * (SOT25 C, SOT26 E), foot 0.35–0.55 (L), lead width 0.35–0.50 (SOT25 A, SOT26 b), body width
 * 1.50–1.70 (SOT25 B, SOT26 E1), body length 2.90–3.10 (SOT25 H, SOT26 D), pitch 0.95.
 * https://www.diodes.com/assets/Package-Files/SOT25.pdf, https://www.diodes.com/assets/Package-Files/SOT26.pdf
 */
const sot2x = (pins: number): IcPackage => ({
  label: `SOT-23-${pins}`,
  pitch: 0.95,
  span: range(2.7, 3.0),
  terminal: range(0.35, 0.55),
  leadWidth: range(0.35, 0.5),
  bodyAcross: range(1.5, 1.7),
  bodyAlong: range(2.9, 3.1),
})

/**
 * SOT-23-8, 0.65 mm pitch: span 2.6–3.0, foot 0.3–0.6, lead width 0.22–0.38, body width 1.5–1.7 (as
 * SOT-23-6), body length 2.8–3.0 (MO-178 nominal 2.9, not the 2.9–3.1 of the cited SOT26 drawing). Written from general knowledge of makers' SOT-23-8 drawings
 * (JEDEC MO-178 BA), not transcribed from one drawing.
 */
const SOT23_8: IcPackage = {
  label: "SOT-23-8",
  pitch: 0.65,
  span: range(2.6, 3.0),
  terminal: range(0.3, 0.6),
  leadWidth: range(0.22, 0.38),
  bodyAcross: range(1.5, 1.7),
  bodyAlong: range(2.8, 3.0),
}

/** Keyed by the variant after "sot23": none, "5", "6" or "8". */
const VARIANTS = new Map<string | undefined, SotVariant>([
  [undefined, SOT23],
  ["5", { pkg: sot2x(5), bottom: [-1, 0, 1], top: [1, -1] }],
  ["6", { pkg: sot2x(6), bottom: [-1, 0, 1], top: [1, 0, -1] }],
  ["8", { pkg: SOT23_8, bottom: [-1.5, -0.5, 0.5, 1.5], top: [1.5, 0.5, -0.5, -1.5] }],
])

function sotPads(variant: SotVariant, centre: number, length: number, width: number): Pad[] {
  const at = (slot: number) => tidy(slot * variant.pkg.pitch)
  const bottom = variant.bottom.map((slot, i) => roundRectPad(String(i + 1), at(slot), -centre, width, length))
  const first = variant.bottom.length + 1
  const top = variant.top.map((slot, i) => roundRectPad(String(first + i), at(slot), centre, width, length))
  return [...bottom, ...top]
}

/** The IPC-7351B nominal footprint for "sot23", "sot23_5", "sot23_6" or "sot23_8", or undefined. */
export function sotFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const variant = parsed.kind === "sot" && parsed.code === "23" ? VARIANTS.get(parsed.variant) : undefined
  if (!variant || !isSimple(parsed) || !confirmsPackage(parsed.params, variant.pkg)) return undefined
  const { pkg } = variant
  const { row, table } = gullWingRow(pkg)
  const pads = sotPads(variant, row.centre, row.length, row.width)
  const body = { x: pkg.bodyAlong.max / 2, y: pkg.bodyAcross.max / 2 }
  const outerLead = Math.max(...[...variant.bottom, ...variant.top].map(Math.abs)) * pkg.pitch + pkg.leadWidth.max / 2
  const component = { x: Math.max(body.x, outerLead), y: pkg.span.max / 2 }
  return {
    name: parsed.variant === undefined ? "sot23" : `sot23_${parsed.variant}`,
    pads,
    courtyard: courtyard(pads, component, table),
    silkscreen: rowSilkscreen(pads, body),
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, ${pkg.label}`,
  }
}
