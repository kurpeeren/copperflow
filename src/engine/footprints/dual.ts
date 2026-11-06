import { confirmsPackage, gullWingRow, range, type IcPackage } from "./ic.js"
import { roundRectPad, type PadRow } from "./ipc7351.js"
import { bodyOutline, centredOffsets, courtyard, dualSilkscreen } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/**
 * Monolithic Power Systems, "Package outline drawing for 8-SOIC", MF-PO-D-0001 revision 3.0;
 * "... for 14-SOIC", MF-PO-D-0071 revision 0.0; "... for 16-SOIC(NB)", MF-PO-D-00035 revision 0.0.
 * Each conforms to JEDEC MS-012 (variations AA, AB, AC) and gives, in millimetres: span 5.80–6.20,
 * foot 0.41–1.27, lead width 0.33–0.51, body width 3.80–4.00, pitch 1.27, and the body length below.
 * https://media.monolithicpower.cn/cms_document/Package%20Information/SOIC-8%20POD.pdf (and SOIC-14,
 * SOIC-16 POD.pdf)
 */
const soic = (pins: number, bodyLength: [number, number]): IcPackage => ({
  label: `SOIC-${pins}`,
  pitch: 1.27,
  span: range(5.8, 6.2),
  terminal: range(0.41, 1.27),
  leadWidth: range(0.33, 0.51),
  bodyAcross: range(3.8, 4.0),
  bodyAlong: range(...bodyLength),
})

const SOIC = new Map<string, IcPackage>([
  ["8", soic(8, [4.8, 5.0])],
  ["14", soic(14, [8.55, 8.75])],
  ["16", soic(16, [9.8, 10.0])],
])

/**
 * The 1.27 mm pitch SOP with a 5.3 mm (208 mil) body: Giantec Semiconductor, "8L 208mil SOP Package
 * Outline", Rev. A, 04/22/2013 (controlling dimension mm): E 7.70–8.10, L 0.51–0.80, b 0.36–0.48,
 * E1 5.18–5.38, D 5.18–5.33, e 1.27.
 * https://www.giantec-semi.com/juchen1123/uploads/pdf/208mil%20SOP8%20Package%20Outline%20Drawing.pdf
 */
const SOP = new Map<string, IcPackage>([
  [
    "8",
    {
      label: "SOP-8",
      pitch: 1.27,
      span: range(7.7, 8.1),
      terminal: range(0.51, 0.8),
      leadWidth: range(0.36, 0.48),
      bodyAcross: range(5.18, 5.38),
      bodyAlong: range(5.18, 5.33),
    },
  ],
])

/**
 * NXP Semiconductors package information (JEDEC MO-153), dimension table of the package outline:
 * TSSOP14 SOT402-1 (8 February 2016), TSSOP16 SOT403-1 (10 December 2019) and TSSOP20 SOT360-1
 * (8 February 2016): HE 6.2–6.6, Lp 0.50–0.75, bp 0.19–0.30, E 4.3–4.5, e 0.65, and D below.
 * https://www.nxp.com/docs/en/package-information/SOT360-1.pdf (and SOT402-1.pdf, SOT403-1.pdf)
 */
const tssop = (pins: number, bodyLength: [number, number]): IcPackage => ({
  label: `TSSOP-${pins}`,
  pitch: 0.65,
  span: range(6.2, 6.6),
  terminal: range(0.5, 0.75),
  leadWidth: range(0.19, 0.3),
  bodyAcross: range(4.3, 4.5),
  bodyAlong: range(...bodyLength),
})

const TSSOP = new Map<string, IcPackage>([
  ["14", tssop(14, [4.9, 5.1])],
  ["16", tssop(16, [4.9, 5.1])],
  ["20", tssop(20, [6.4, 6.6])],
])

const FAMILIES = new Map<string, ReadonlyMap<string, IcPackage>>([
  ["soic", SOIC],
  ["sop", SOP],
  ["tssop", TSSOP],
])

/** Pad 1 at the top of the left column; the left column runs down, the right column back up. */
function dualPads(pins: number, pitch: number, row: PadRow): Pad[] {
  const ys = centredOffsets(pins / 2, pitch)
  const left = [...ys].reverse().map((y, i) => roundRectPad(String(i + 1), -row.centre, y, row.length, row.width))
  const right = ys.map((y, i) => roundRectPad(String(pins / 2 + i + 1), row.centre, y, row.length, row.width))
  return [...left, ...right]
}

/** The IPC-7351B nominal footprint for "soic8", "sop8", "tssop20" and the like, or undefined. */
export function dualFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const pkg = FAMILIES.get(parsed.kind)?.get(parsed.code)
  if (!pkg || parsed.variant !== undefined || !confirmsPackage(parsed.params, pkg)) return undefined
  const pins = Number(parsed.code)
  const { row, table } = gullWingRow(pkg)
  const pads = dualPads(pins, pkg.pitch, row)
  const body = { x: pkg.bodyAcross.max / 2, y: pkg.bodyAlong.max / 2 }
  const outerLead = ((pins / 2 - 1) / 2) * pkg.pitch + pkg.leadWidth.max / 2
  const component = { x: pkg.span.max / 2, y: Math.max(body.y, outerLead) }
  return {
    name: `${parsed.kind}${parsed.code}`,
    pads,
    courtyard: courtyard(pads, component, table),
    silkscreen: dualSilkscreen(pads, body),
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, ${pkg.label}`,
  }
}
