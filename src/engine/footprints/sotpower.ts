import { gullWingRow, range, type IcPackage } from "./ic.js"
import { roundRectPad, type Range } from "./ipc7351.js"
import { bodyOutline, courtyard, rowSilkscreen } from "./outline.js"
import { isSimple, type ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/** A power SOT: three leads along the bottom and a wide tab on top. */
interface PowerSot {
  pkg: IcPackage
  /** The width of the tab lead (b1, b3). */
  tabWidth: Range
  /** The pad number of the tab: pin 4 on a SOT-223, joined to pin 2 on a SOT-89. */
  tabNumber: string
}

/**
 * SOT-223 (JEDEC TO-261AA), in the dimensions of NXP's "SOT223" package outline: HE 6.7–7.3,
 * Lp 0.7–1.1, bp 0.6–0.8, b1 2.9–3.1, E 3.3–3.7, D 6.3–6.7, e 2.3. Written from general knowledge
 * of that drawing, not transcribed from it; a part's own drawing should confirm.
 */
const SOT223: PowerSot = {
  pkg: {
    label: "SOT-223",
    pitch: 2.3,
    span: range(6.7, 7.3),
    terminal: range(0.7, 1.1),
    leadWidth: range(0.6, 0.8),
    bodyAcross: range(3.3, 3.7),
    bodyAlong: range(6.3, 6.7),
  },
  tabWidth: range(2.9, 3.1),
  tabNumber: "4",
}

/**
 * SOT-89 (JEDEC TO-243AA), in the dimensions makers' outline drawings commonly give: overall
 * 3.94–4.25 from the lead toes to the far side, lead foot 0.89–1.20, lead width 0.44–0.56, tab
 * width 1.62–1.83, body 4.40–4.60 by 2.40–2.60, pitch 1.5. Written from general knowledge, not
 * transcribed from one drawing.
 *
 * The SOT-89 has leads on one side only; its tab, joined to pin 2, shows on the far side. The land
 * pattern treats the tab as a second row of the gull-wing equations with the leads' foot length,
 * which is a simplification made here, not an IPC-7351B rule for this package.
 */
const SOT89: PowerSot = {
  pkg: {
    label: "SOT-89",
    pitch: 1.5,
    span: range(3.94, 4.25),
    terminal: range(0.89, 1.2),
    leadWidth: range(0.44, 0.56),
    bodyAcross: range(2.4, 2.6),
    bodyAlong: range(4.4, 4.6),
  },
  tabWidth: range(1.62, 1.83),
  tabNumber: "2",
}

const PACKAGES = new Map<string, PowerSot>([
  ["223", SOT223],
  ["89", SOT89],
])

/** Pads 1 to 3 along the bottom, left to right, and the tab centred on top. */
function powerSotPads(sot: PowerSot): Pad[] {
  const { row } = gullWingRow(sot.pkg)
  const tab = gullWingRow({ ...sot.pkg, leadWidth: sot.tabWidth }).row
  const pitch = sot.pkg.pitch
  const leads = [-pitch, 0, pitch].map((x, i) => roundRectPad(String(i + 1), x, -row.centre, row.width, row.length))
  return [...leads, roundRectPad(sot.tabNumber, 0, tab.centre, tab.width, tab.length)]
}

/** The IPC-7351B nominal footprint for "sot223" or "sot89", or undefined. */
export function powerSotFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const sot = parsed.kind === "sot" ? PACKAGES.get(parsed.code) : undefined
  if (!sot || !isSimple(parsed) || parsed.variant !== undefined || Object.keys(parsed.params).length > 0) return undefined
  const { pkg } = sot
  const { table } = gullWingRow(pkg)
  const pads = powerSotPads(sot)
  const body = { x: pkg.bodyAlong.max / 2, y: pkg.bodyAcross.max / 2 }
  const outerLead = pkg.pitch + pkg.leadWidth.max / 2
  const component = { x: Math.max(body.x, outerLead, sot.tabWidth.max / 2), y: pkg.span.max / 2 }
  return {
    name: `sot${parsed.code}`,
    pads,
    courtyard: courtyard(pads, component, table),
    silkscreen: rowSilkscreen(pads, body),
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, ${pkg.label}`,
  }
}
