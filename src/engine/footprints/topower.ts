import type { Point } from "../model.js"
import { range } from "./ic.js"
import type { Range } from "./ipc7351.js"
import { leadDiameter, THROUGH_HOLE_COURTYARD, throughHoleLand, throughHolePad } from "./ipc7251.js"
import { centredOffsets, courtyard, pinOneTick, tidy } from "./outline.js"
import { isSimple, type ParsedFootprint } from "./parse.js"
import { refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/**
 * An upright through-hole power package seen from the top, laid out as `to220.ts` lays out TO-220:
 * the leads in a row on y = 0, the front face of the plastic at `front` (−y), the back at `back`, and
 * a metal tab whose front face is at `tab` when the package has one. Pad 1 is at the left seen from
 * the front and square.
 */
interface UprightPackage {
  name: string
  label: string
  leads: number
  pitch: number
  leadWidth: Range
  leadThickness: Range
  halfWidth: number
  front: number
  back: number
  tab?: number
  /**
   * Set when the IPC-2222 hole and round land do not fit between neighbouring leads: this hole is used
   * instead, and the land becomes an oval `narrowLand` wide along the row and `land` long across it.
   */
  narrow?: { drill: number; width: number; length: number }
}

/** The pin 1 tick sits this far in front of the body, as in `to220.ts`. */
const TICK_GAP = 0.3

/**
 * TO-220 bodies for the two- and five-lead forms: the same body and tab numbers as `to220.ts`
 * (width 10.66, front 2.0 in front of the leads, tab back 2.5 behind, tab 1.27 thick; lead width
 * 0.70–0.90, thickness 0.45–0.60), written from general knowledge of makers' drawings, not
 * transcribed from one. "to220_2" has two leads 5.08 mm apart (TO-220AC, the middle lead left out).
 *
 * "to220_5" has five leads in a straight row at 1.70 mm (the TO-220-5 straight-lead form; the
 * staggered form is not made). Its leads are thinner, about 0.64–0.90 × 0.40–0.50 (general knowledge,
 * not one drawing). The IPC-2222 hole for that lead (diagonal 1.03 + 0.20 → 1.25) cannot meet
 * copperflow's design rules at 1.70 mm: with the 0.18 mm minimum ring of the stricter shipped profile
 * the lands would be 1.61 wide and only 0.09 apart. So the hole is the smallest practical one, 1.10 mm,
 * 0.07 over the lead diagonal and below the IPC-2222 allowance: an assembler should confirm it for the
 * part. The lands are ovals 1.46 wide along the row (1.10 + 2 × 0.18) and 2.00 long across it,
 * leaving 0.24 mm of copper and 0.60 mm hole to hole between neighbours.
 */
const TO220_BODY = { halfWidth: 10.66 / 2, front: -2, back: 2.5, tab: 2.5 - 1.27, leadWidth: range(0.7, 0.9), leadThickness: range(0.45, 0.6) }

const TO220_2: UprightPackage = { name: "to220_2", label: "TO-220-2", leads: 2, pitch: 5.08, ...TO220_BODY }
const TO220_5: UprightPackage = {
  name: "to220_5",
  label: "TO-220-5",
  leads: 5,
  pitch: 1.7,
  ...TO220_BODY,
  leadWidth: range(0.64, 0.9),
  leadThickness: range(0.4, 0.5),
  narrow: { drill: 1.1, width: 1.46, length: 2 },
}

/**
 * onsemi, "TO-247-3LD SHORT LEAD", case 340CK, issue A, 31 Jan 2019, document 98AON13851G, page 1,
 * dimension table (mm): A 4.58–4.82 (body thickness), A1 2.20–2.60 (lead plane to the back face),
 * b 1.17–1.35 (lead width), c 0.51–0.71 (lead thickness), E 15.37–15.87 (body width), e 5.56 nominal.
 * https://www.onsemi.com/pub/Collateral/340CK.PDF
 * The pitch is taken as 5.45 mm, the JEDEC TO-247 lead spacing most makers draw, not the 5.56 of this
 * drawing; the 0.11 mm difference stays inside the 0.2 mm hole allowance. The back face is placed
 * A1max (2.60) behind the lead plane and the front face Amax − A1max (2.22) in front of it, so the
 * outline is Amax (4.82) deep. TO-247 has no separate tab: its metal back is the back face.
 */
const TO247: UprightPackage = {
  name: "to247",
  label: "TO-247",
  leads: 3,
  pitch: 5.45,
  leadWidth: range(1.17, 1.35),
  leadThickness: range(0.51, 0.71),
  halfWidth: 15.87 / 2,
  front: -(4.82 - 2.6),
  back: 2.6,
}

/**
 * TO-126 (SOT-32), in the dimensions makers' outline drawings commonly give: three leads 2.29 mm
 * apart, lead width 0.60–0.90 and thickness 0.40–0.60, body 7.4–7.8 wide and 2.5–2.9 thick with the
 * lead plane about 1.5 mm behind the front face. Written from general knowledge of those drawings, not
 * transcribed from one.
 */
const TO126: UprightPackage = {
  name: "to126",
  label: "TO-126",
  leads: 3,
  pitch: 2.29,
  leadWidth: range(0.6, 0.9),
  leadThickness: range(0.4, 0.6),
  halfWidth: 7.8 / 2,
  front: -1.5,
  back: 1.4,
}

function body(pkg: UprightPackage): Point[] {
  const [x, f, b] = [tidy(pkg.halfWidth), tidy(pkg.front), tidy(pkg.back)]
  return [{ x: -x, y: f }, { x, y: f }, { x, y: b }, { x: -x, y: b }, { x: -x, y: f }]
}

/** A round IPC-2222 land, or the package's narrow oval land and hole. Pad 1 square (a rectangle for the oval). */
function rowPad(number: string, x: number, pkg: UprightPackage, square: boolean): { pad: Pad; text: string } {
  const land = throughHoleLand(leadDiameter(pkg.leadWidth, pkg.leadThickness))
  if (!pkg.narrow) return { pad: throughHolePad(number, x, 0, land, square), text: `${land.drill} mm holes, ${land.pad} mm lands (IPC-2222 level B)` }
  const { drill, width, length } = pkg.narrow
  const pad: Pad = { ...throughHolePad(number, x, 0, { drill, pad: length }, square), shape: square ? "rect" : "oval", width }
  return { pad, text: `${drill} mm holes (below the IPC-2222 allowance), ${width} × ${length} mm oval lands` }
}

function uprightFootprint(pkg: UprightPackage): Footprint {
  const made = centredOffsets(pkg.leads, pkg.pitch).map((x, i) => rowPad(String(i + 1), x, pkg, i === 0))
  const pads = made.map((m) => m.pad)
  const tab: Point[][] = pkg.tab === undefined ? [] : [[{ x: -tidy(pkg.halfWidth), y: tidy(pkg.tab) }, { x: tidy(pkg.halfWidth), y: tidy(pkg.tab) }]]
  return {
    name: pkg.name,
    pads,
    courtyard: courtyard(pads, { x: pkg.halfWidth, y: Math.max(TICK_GAP - pkg.front, pkg.back) }, THROUGH_HOLE_COURTYARD),
    silkscreen: [body(pkg), ...tab, pinOneTick(pads[0] as Pad, pkg.front - TICK_GAP)],
    fabrication: [body(pkg), ...tab],
    origin: `Through-hole, ${pkg.label} upright: ${made[0]?.text ?? ""}`,
  }
}

const noParams = (parsed: ParsedFootprint) => isSimple(parsed) && Object.keys(parsed.params).length === 0

/**
 * "to247", "to126", "to220_2", "to220_5"; a refusal for other "to220_<n>" and for variants of "to247"
 * and "to126"; otherwise undefined. "to220" itself is left to `to220Footprint`.
 */
export function toPowerFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (parsed.kind !== "to" || !noParams(parsed)) return undefined
  if (parsed.code === "220" && parsed.variant !== undefined) {
    if (parsed.variant === "2") return uprightFootprint(TO220_2)
    if (parsed.variant === "5") return uprightFootprint(TO220_5)
    return refuse("TO-220 comes as to220 (3 leads), to220_2 or to220_5")
  }
  const pkg = parsed.code === "247" ? TO247 : parsed.code === "126" ? TO126 : undefined
  if (!pkg) return undefined
  return parsed.variant === undefined ? uprightFootprint(pkg) : refuse(`${pkg.label} has three leads and takes no variant`)
}
