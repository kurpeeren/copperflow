import { confirmsPackage, gullWingRow, range, type IcPackage } from "./ic.js"
import { roundRectPad, type PadRow, type Range } from "./ipc7351.js"
import { bodyOutline, centredOffsets, courtyard, dualSilkscreen } from "./outline.js"
import { parseFootprint, type ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/**
 * A series of gull-wing dual packages that share their lead outline and differ only in pin count:
 * every member has the same pitch, span, foot and lead width, and a body length by pin count.
 */
interface DualSeries {
  /** The string's kind ("soic") and suffix ("w" for the wide SOIC, "" for none). */
  kind: string
  suffix: string
  label: (pins: number) => string
  pins: readonly number[]
  lead: Omit<IcPackage, "label" | "bodyAlong">
  /** Body length by pin count, from the outline drawing. */
  bodyLength: ReadonlyMap<number, Range>
  /**
   * For a pin count the drawing does not list: the body reaches this far past the centres of the
   * outermost leads at each end (the mean overhang of the listed sizes), ± `bodyTolerance`.
   */
  overhang: number
  bodyTolerance: number
}

const evens = (from: number, to: number) => Array.from({ length: (to - from) / 2 + 1 }, (_, i) => from + 2 * i)

/**
 * Narrow SOIC, 3.9 mm body: Monolithic Power Systems, "Package outline drawing for 8-SOIC",
 * MF-PO-D-0001 revision 3.0; "... for 14-SOIC", MF-PO-D-0071 revision 0.0; "... for 16-SOIC(NB)",
 * MF-PO-D-00035 revision 0.0. Each conforms to JEDEC MS-012 (variations AA, AB, AC) and gives, in
 * millimetres: span 5.80–6.20, foot 0.41–1.27, lead width 0.33–0.51, body width 3.80–4.00, pitch
 * 1.27, and the body lengths below. MS-012 has no 10 or 12 lead variation; those take the overhang.
 * https://media.monolithicpower.cn/cms_document/Package%20Information/SOIC-8%20POD.pdf (and SOIC-14,
 * SOIC-16 POD.pdf)
 */
const SOIC: DualSeries = {
  kind: "soic",
  suffix: "",
  label: (pins) => `SOIC-${pins}`,
  pins: evens(8, 16),
  lead: { pitch: 1.27, span: range(5.8, 6.2), terminal: range(0.41, 1.27), leadWidth: range(0.33, 0.51), bodyAcross: range(3.8, 4.0) },
  bodyLength: new Map([
    [8, range(4.8, 5.0)],
    [14, range(8.55, 8.75)],
    [16, range(9.8, 10.0)],
  ]),
  overhang: 0.53,
  bodyTolerance: 0.1,
}

/**
 * Wide SOIC, 7.5 mm (300 mil) body: JEDEC MS-013 revision F, variations AA (16), AB (18), AC (20),
 * AD (24) and AE (28), in millimetres: E 10.00–10.65 toe to toe, L 0.40–1.27, b 0.31–0.51, E1
 * 7.40–7.60, e 1.27, and D by lead count 10.10–10.50, 11.35–11.75, 12.60–13.00, 15.20–15.60,
 * 17.70–18.10. These are written from general knowledge of MS-013, not transcribed from one drawing.
 */
const SOIC_WIDE: DualSeries = {
  kind: "soic",
  suffix: "w",
  label: (pins) => `SOIC-${pins} wide`,
  pins: [16, 18, 20, 24, 28],
  lead: { pitch: 1.27, span: range(10.0, 10.65), terminal: range(0.4, 1.27), leadWidth: range(0.31, 0.51), bodyAcross: range(7.4, 7.6) },
  bodyLength: new Map([
    [16, range(10.1, 10.5)],
    [18, range(11.35, 11.75)],
    [20, range(12.6, 13.0)],
    [24, range(15.2, 15.6)],
    [28, range(17.7, 18.1)],
  ]),
  overhang: 0.6,
  bodyTolerance: 0.2,
}

/**
 * The 1.27 mm pitch SOP with a 5.3 mm (208 mil) body: Giantec Semiconductor, "8L 208mil SOP Package
 * Outline", Rev. A, 04/22/2013 (controlling dimension mm): E 7.70–8.10, L 0.51–0.80, b 0.36–0.48,
 * E1 5.18–5.38, D 5.18–5.33, e 1.27. Longer members take the 8-lead overhang.
 * https://www.giantec-semi.com/juchen1123/uploads/pdf/208mil%20SOP8%20Package%20Outline%20Drawing.pdf
 */
const SOP: DualSeries = {
  kind: "sop",
  suffix: "",
  label: (pins) => `SOP-${pins}`,
  pins: evens(8, 16),
  lead: { pitch: 1.27, span: range(7.7, 8.1), terminal: range(0.51, 0.8), leadWidth: range(0.36, 0.48), bodyAcross: range(5.18, 5.38) },
  bodyLength: new Map([[8, range(5.18, 5.33)]]),
  overhang: 0.72,
  bodyTolerance: 0.08,
}

/**
 * SSOP, 0.65 mm pitch, 5.3 mm body: JEDEC MO-150 revision B, in millimetres: E 7.40–8.20, L 0.55–0.95,
 * b 0.22–0.38, E1 5.00–5.60, e 0.65, and D 5.90–6.50 (14 and 16 leads), 6.90–7.50 (20), 7.90–8.50
 * (24), 9.90–10.50 (28). Written from general knowledge of MO-150, not transcribed from one drawing.
 * Only the lead counts with a listed body length are made.
 */
const SSOP: DualSeries = {
  kind: "ssop",
  suffix: "",
  label: (pins) => `SSOP-${pins}`,
  pins: [14, 16, 20, 24, 28],
  lead: { pitch: 0.65, span: range(7.4, 8.2), terminal: range(0.55, 0.95), leadWidth: range(0.22, 0.38), bodyAcross: range(5.0, 5.6) },
  bodyLength: new Map([
    [14, range(5.9, 6.5)],
    [16, range(5.9, 6.5)],
    [20, range(6.9, 7.5)],
    [24, range(7.9, 8.5)],
    [28, range(9.9, 10.5)],
  ]),
  overhang: 0.7,
  bodyTolerance: 0.3,
}

/**
 * TSSOP, 0.65 mm pitch, 4.4 mm body. NXP Semiconductors package information (JEDEC MO-153),
 * dimension table of the package outline: TSSOP14 SOT402-1 (8 February 2016), TSSOP16 SOT403-1
 * (10 December 2019) and TSSOP20 SOT360-1 (8 February 2016): HE 6.2–6.6, Lp 0.50–0.75, bp 0.19–0.30,
 * E 4.3–4.5, e 0.65, and D below. https://www.nxp.com/docs/en/package-information/SOT360-1.pdf (and
 * SOT402-1.pdf, SOT403-1.pdf). The foot is taken as MO-153's L 0.45–0.75, which covers NXP's narrower
 * range and other makers' parts. D for 8, 24 and 28 leads (2.90–3.10, 7.70–7.90, 9.60–9.80) is MO-153's
 * (AA, AD, AE), written from general knowledge; other counts take the overhang.
 */
const TSSOP: DualSeries = {
  kind: "tssop",
  suffix: "",
  label: (pins) => `TSSOP-${pins}`,
  pins: evens(8, 28),
  lead: { pitch: 0.65, span: range(6.2, 6.6), terminal: range(0.45, 0.75), leadWidth: range(0.19, 0.3), bodyAcross: range(4.3, 4.5) },
  bodyLength: new Map([
    [8, range(2.9, 3.1)],
    [14, range(4.9, 5.1)],
    [16, range(4.9, 5.1)],
    [20, range(6.4, 6.6)],
    [24, range(7.7, 7.9)],
    [28, range(9.6, 9.8)],
  ]),
  overhang: 0.6,
  bodyTolerance: 0.1,
}

const SERIES: readonly DualSeries[] = [SOIC, SOIC_WIDE, SOP, SSOP, TSSOP]

/** The string forms, for messages: `soic<N>` and the pin counts each takes. */
export const DUAL_FORMS: readonly { form: string; pins: readonly number[] }[] = SERIES.map((s) => ({
  form: `${s.kind}<N>${s.suffix}`,
  pins: s.pins,
}))

/** The series whose outline was written from general knowledge, not taken from a drawing: MS-013 and MO-150. */
const FROM_MEMORY: ReadonlySet<DualSeries> = new Set([SOIC_WIDE, SSOP])

/** Whether a footprint string names a package whose outline was not taken from a drawing ("soic18w", "ssop20"). */
export function outlineFromMemory(text: string): boolean {
  const parsed = parseFootprint(text)
  return parsed !== undefined && SERIES.some((s) => FROM_MEMORY.has(s) && s.kind === parsed.kind && s.suffix === (parsed.suffix ?? ""))
}

function packageOf(series: DualSeries, pins: number): IcPackage {
  const listed = series.bodyLength.get(pins)
  const nominal = (pins / 2 - 1) * series.lead.pitch + 2 * series.overhang
  const bodyAlong = listed ?? range(nominal - series.bodyTolerance, nominal + series.bodyTolerance)
  return { ...series.lead, label: series.label(pins), bodyAlong }
}

/** Pad 1 at the top of the left column; the left column runs down, the right column back up. */
export function dualPads(pins: number, pitch: number, row: PadRow): Pad[] {
  const ys = centredOffsets(pins / 2, pitch)
  const left = [...ys].reverse().map((y, i) => roundRectPad(String(i + 1), -row.centre, y, row.length, row.width))
  const right = ys.map((y, i) => roundRectPad(String(pins / 2 + i + 1), row.centre, y, row.length, row.width))
  return [...left, ...right]
}

/** The pin count a series takes from this string, or undefined. */
function pinsOf(parsed: ParsedFootprint, series: DualSeries): number | undefined {
  if (parsed.cross !== undefined || parsed.size !== undefined || parsed.pairs !== undefined || parsed.variant !== undefined) return undefined
  const pins = Number(parsed.code)
  return String(pins) === parsed.code && series.pins.includes(pins) ? pins : undefined
}

/** The IPC-7351B nominal footprint for "soic8", "soic18w", "sop8", "ssop20", "tssop20" and the like, or undefined. */
export function dualFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const series = SERIES.find((s) => s.kind === parsed.kind && s.suffix === (parsed.suffix ?? ""))
  const pins = series && pinsOf(parsed, series)
  if (!series || pins === undefined) return undefined
  const pkg = packageOf(series, pins)
  if (!confirmsPackage(parsed.params, pkg)) return undefined
  const { row, table } = gullWingRow(pkg)
  const pads = dualPads(pins, pkg.pitch, row)
  const body = { x: pkg.bodyAcross.max / 2, y: pkg.bodyAlong.max / 2 }
  const outerLead = ((pins / 2 - 1) / 2) * pkg.pitch + pkg.leadWidth.max / 2
  const component = { x: pkg.span.max / 2, y: Math.max(body.y, outerLead) }
  return {
    name: `${parsed.kind}${parsed.code}${series.suffix}`,
    pads,
    courtyard: courtyard(pads, component, table),
    silkscreen: dualSilkscreen(pads, body),
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, ${pkg.label}`,
  }
}
