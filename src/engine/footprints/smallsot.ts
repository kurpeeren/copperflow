import { confirmsPackage, gullWingRow, range, type IcPackage } from "./ic.js"
import { roundRectPad } from "./ipc7351.js"
import { bodyOutline, courtyard, rowSilkscreen, tidy } from "./outline.js"
import { isSimple, type ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/**
 * A small SOT: its outline, where its leads sit along each row (in mm from the centre), and the
 * lead width of pin 1 when it differs from the others (SOT-143).
 */
interface SmallSot {
  name: string
  pkg: IcPackage
  /** Pads 1, 2, … along the bottom row, left to right, x in mm. */
  bottom: readonly number[]
  /** The remaining pads along the top row, right to left, x in mm. */
  top: readonly number[]
  /** Lead width of pin 1 when it is the wide one. */
  wideFirst?: IcPackage["leadWidth"]
}

/**
 * NXP Semiconductors, "SOT323 package information", 29 July 2019, page 2, Figure 1 dimension table
 * (SC-70): HE 2.0–2.2, Lp 0.15–0.45, bp 0.3–0.4, E 1.15–1.35, D 1.8–2.2, e 1.3, e1 0.65.
 * https://www.nxp.com/docs/en/package-information/SOT323.pdf
 */
const SOT323: IcPackage = {
  label: "SOT-323 (SC-70)",
  pitch: 0.65,
  span: range(2.0, 2.2),
  terminal: range(0.15, 0.45),
  leadWidth: range(0.3, 0.4),
  bodyAcross: range(1.15, 1.35),
  bodyAlong: range(1.8, 2.2),
}

/**
 * NXP Semiconductors, "SOT353-1 package information", 8 February 2016, page 2, Figure 1 dimension
 * table (TSSOP5, JEDEC MO-203, SC-88A): HE 2.0–2.25, Lp 0.21–0.46, bp 0.15–0.30, E 1.15–1.35,
 * D 1.85–2.25, e 0.65. https://www.nxp.com/docs/en/package-information/SOT353-1.pdf
 */
const SOT353: IcPackage = {
  label: "SOT-353 (SC-70-5)",
  pitch: 0.65,
  span: range(2.0, 2.25),
  terminal: range(0.21, 0.46),
  leadWidth: range(0.15, 0.3),
  bodyAcross: range(1.15, 1.35),
  bodyAlong: range(1.85, 2.25),
}

/**
 * NXP Semiconductors, "SOT363 package information", 9 May 2018, page 2, Figure 1 dimension table
 * (TSSOP6, SC-88): HE 2.0–2.2, Lp 0.15–0.45, bp 0.20–0.30, E 1.15–1.35, D 1.8–2.2, e1 0.65.
 * https://www.nxp.com/docs/en/package-information/SOT363.pdf
 */
const SOT363: IcPackage = {
  label: "SOT-363 (SC-70-6)",
  pitch: 0.65,
  span: range(2.0, 2.2),
  terminal: range(0.15, 0.45),
  leadWidth: range(0.2, 0.3),
  bodyAcross: range(1.15, 1.35),
  bodyAlong: range(1.8, 2.2),
}

/**
 * The packages below are written from general knowledge of makers' drawings (onsemi, Diodes Inc.,
 * Nexperia, NXP) for these outlines, not transcribed from one drawing; a part's own drawing should
 * confirm them.
 * - SOT-523 (SC-89, 3 leads, 0.5 mm): HE 1.5–1.7, L 0.1–0.3, b 0.15–0.3, E 0.7–0.9, D 1.5–1.7.
 * - SOT-563 (6 leads, 0.5 mm): HE 1.5–1.7, L 0.1–0.3, b 0.15–0.3, E 1.1–1.3, D 1.5–1.7.
 * - SOT-723 (3 leads, 0.4 mm): HE 1.15–1.25, L 0.1–0.2, b 0.15–0.25, E 0.75–0.85, D 1.15–1.25. The
 *   drain lead of SOT-723 is often drawn wider; all three take the narrow width here.
 * - SOT-143 (4 leads): HE 2.1–2.5, Lp 0.15–0.45, b 0.38–0.48 and pin 1 0.76–0.89, E 1.2–1.4,
 *   D 2.8–3.0; pins 3 and 4 at ±0.95, pin 2 at +0.95, pin 1 at −0.75 (1.7 from pin 2).
 */
const SOT523: IcPackage = {
  label: "SOT-523 (SC-89)",
  pitch: 0.5,
  span: range(1.5, 1.7),
  terminal: range(0.1, 0.3),
  leadWidth: range(0.15, 0.3),
  bodyAcross: range(0.7, 0.9),
  bodyAlong: range(1.5, 1.7),
}
const SOT563: IcPackage = { ...SOT523, label: "SOT-563", bodyAcross: range(1.1, 1.3) }
const SOT723: IcPackage = {
  label: "SOT-723",
  pitch: 0.4,
  span: range(1.15, 1.25),
  terminal: range(0.1, 0.2),
  leadWidth: range(0.15, 0.25),
  bodyAcross: range(0.75, 0.85),
  bodyAlong: range(1.15, 1.25),
}
const SOT143: IcPackage = {
  label: "SOT-143",
  pitch: 0.95,
  span: range(2.1, 2.5),
  terminal: range(0.15, 0.45),
  leadWidth: range(0.38, 0.48),
  bodyAcross: range(1.2, 1.4),
  bodyAlong: range(2.8, 3.0),
}

const three = (pitch: number) => ({ bottom: [-pitch, pitch], top: [0] })
const five = (pitch: number) => ({ bottom: [-pitch, 0, pitch], top: [pitch, -pitch] })
const six = (pitch: number) => ({ bottom: [-pitch, 0, pitch], top: [pitch, 0, -pitch] })

const SMALL_SOTS: readonly SmallSot[] = [
  { name: "sot323", pkg: SOT323, ...three(0.65) },
  { name: "sot353", pkg: SOT353, ...five(0.65) },
  { name: "sot363", pkg: SOT363, ...six(0.65) },
  { name: "sot523", pkg: SOT523, ...three(0.5) },
  { name: "sot563", pkg: SOT563, ...six(0.5) },
  { name: "sot723", pkg: SOT723, ...three(0.4) },
  { name: "sot143", pkg: SOT143, bottom: [-0.75, 0.95], top: [0.95, -0.95], wideFirst: range(0.76, 0.89) },
]

/** The strings and their aliases (SC-70 names). */
const BY_NAME = new Map<string, SmallSot>([
  ...SMALL_SOTS.map((sot) => [sot.name, sot] as const),
  ["sc70", SMALL_SOTS[0] as SmallSot],
  ["sc70_5", SMALL_SOTS[1] as SmallSot],
  ["sc70_6", SMALL_SOTS[2] as SmallSot],
])

function keyOf(parsed: ParsedFootprint): string | undefined {
  if (!isSimple(parsed)) return undefined
  return `${parsed.kind}${parsed.code}${parsed.variant === undefined ? "" : `_${parsed.variant}`}`
}

function smallSotPads(sot: SmallSot): Pad[] {
  const { row } = gullWingRow(sot.pkg)
  const wide = sot.wideFirst ? gullWingRow({ ...sot.pkg, leadWidth: sot.wideFirst }).row.width : row.width
  const bottom = sot.bottom.map((x, i) => roundRectPad(String(i + 1), tidy(x), -row.centre, i === 0 ? wide : row.width, row.length))
  const first = sot.bottom.length + 1
  const top = sot.top.map((x, i) => roundRectPad(String(first + i), tidy(x), row.centre, row.width, row.length))
  return [...bottom, ...top]
}

/**
 * The IPC-7351B nominal footprint for a small SOT ("sot323", "sc70", "sot363", "sot143", …), or
 * undefined. Pin 1 at the left of the bottom row, numbers counter-clockwise seen from the top, as
 * "sot23_5" and "sot23_6" have them.
 */
export function smallSotFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const key = keyOf(parsed)
  const sot = key === undefined ? undefined : BY_NAME.get(key)
  if (!key || !sot || !confirmsPackage(parsed.params, sot.pkg)) return undefined
  const { pkg } = sot
  const { table } = gullWingRow(pkg)
  const pads = smallSotPads(sot)
  const body = { x: pkg.bodyAlong.max / 2, y: pkg.bodyAcross.max / 2 }
  const outerLead = Math.max(...pads.map((p) => Math.abs(p.x) + p.width / 2))
  const component = { x: Math.max(body.x, outerLead), y: pkg.span.max / 2 }
  return {
    name: key,
    pads,
    courtyard: courtyard(pads, component, table),
    silkscreen: rowSilkscreen(pads, body),
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, ${pkg.label}`,
  }
}
