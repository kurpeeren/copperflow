import type { Point } from "../model.js"
import { MOLDED_BODY_TABLE, roundRectPad, type Range } from "./ipc7351.js"
import { bodyOutline, courtyard, sideLines, SILK_CLEARANCE, tidy } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/** The maker's land pattern: pad length along x, pad width across, and the gap S between the pads. */
interface Land {
  length: number
  width: number
  gap: number
}

/** A moulded tantalum case: body length L and width W, and its level B land. */
interface TantalumCase {
  label: string
  length: Range
  width: Range
  land: Land
}

const range = (min: number, max: number): Range => ({ min, max })

/**
 * KEMET (YAGEO Group), "Tantalum Surface Mount Capacitors – Standard Tantalum, T491 Industrial Grade
 * MnO2", T2005_T491 (2026-07-08), page 4, table "Dimensions – Millimeters (Inches)", metric governs:
 * L, W, F ± 0.1 (terminal width) and S (terminal length on the bottom), by case:
 * - A 3216-18: L 3.2 ± 0.2, W 1.6 ± 0.2, F 1.2, S 0.80 +0.2/−0.3
 * - B 3528-21: L 3.5 ± 0.2, W 2.8 ± 0.2, F 2.2, S 0.80 +0.1/−0.3
 * - C 6032-28: L 6.0 ± 0.3, W 3.2 ± 0.3, F 2.2, S 1.30 ± 0.3
 * - D 7343-31: L 7.3 ± 0.3, W 4.3 ± 0.3, F 2.4, S 1.30 ± 0.3
 * - X 7343-43: L 7.3 ± 0.3, W 4.3 ± 0.3, F 2.4, S 1.30 ± 0.3 (KEMET's letter X; "tant_e" here, the
 *   letter other makers give 7343-43; KEMET's own E is 7360-38, not made here)
 * The anode (+) end is marked on the body. https://yageogroup.com/content/datasheet/asset/file/KEM_T2005_T491
 *
 * The lands are not computed: the same data sheet, page 15, "Table 2 – Land Dimensions/Courtyard",
 * gives them, and the Density Level B "Median (Nominal) Land Protrusion" columns are used as they
 * stand: W (pad width across), L (pad length along the part) and S (gap between the pads), in mm:
 * A 1.23 / 1.80 / 0.82, B 2.23 / 1.80 / 1.12, C 2.23 / 2.37 / 2.57, D 2.43 / 2.37 / 3.87,
 * X 2.43 / 2.37 / 3.87. (Computing from L and S with the moulded-body goals gave case A a 0.30 mm gap.)
 * The courtyard is made as for the other two-terminal parts, not from the table's V1 × V2.
 */
const CASE_A: TantalumCase = { label: "EIA 3216-18 (A)", length: range(3.0, 3.4), width: range(1.4, 1.8), land: { length: 1.8, width: 1.23, gap: 0.82 } }
const CASE_B: TantalumCase = { label: "EIA 3528-21 (B)", length: range(3.3, 3.7), width: range(2.6, 3.0), land: { length: 1.8, width: 2.23, gap: 1.12 } }
const CASE_C: TantalumCase = { label: "EIA 6032-28 (C)", length: range(5.7, 6.3), width: range(2.9, 3.5), land: { length: 2.37, width: 2.23, gap: 2.57 } }
const CASE_D: TantalumCase = { label: "EIA 7343-31 (D)", length: range(7.0, 7.6), width: range(4.0, 4.6), land: { length: 2.37, width: 2.43, gap: 3.87 } }
const CASE_E: TantalumCase = { ...CASE_D, label: "EIA 7343-43 (E, KEMET X)" }

const BY_LETTER = new Map<string, TantalumCase>([
  ["a", CASE_A],
  ["b", CASE_B],
  ["c", CASE_C],
  ["d", CASE_D],
  ["e", CASE_E],
])
/** By size: 7343 is the 31 mm-tenths high D case. */
const BY_SIZE = new Map<string, TantalumCase>([
  ["3216", CASE_A],
  ["3528", CASE_B],
  ["6032", CASE_C],
  ["7343", CASE_D],
])

const FORMS = "tant_a … tant_e or tant3216, tant3528, tant6032, tant7343"
/** The "+" by pad 1: half its arm length, as radial.ts draws it. */
const PLUS_ARM = 0.4

/** A "+" above pad 1, its lowest point the silkscreen clearance above the pad. */
function plusMark(pad: Pad): Point[][] {
  const cy = tidy(pad.y + pad.height / 2 + SILK_CLEARANCE + 0.05 + PLUS_ARM)
  return [
    [{ x: tidy(pad.x - PLUS_ARM), y: cy }, { x: tidy(pad.x + PLUS_ARM), y: cy }],
    [{ x: tidy(pad.x), y: tidy(cy - PLUS_ARM) }, { x: tidy(pad.x), y: tidy(cy + PLUS_ARM) }],
  ]
}

function caseOf(parsed: ParsedFootprint): TantalumCase | Refusal | undefined {
  const plain = parsed.variant === undefined && parsed.cross === undefined && parsed.suffix === undefined && parsed.size === undefined && parsed.pairs === undefined
  if (parsed.kind !== "tant" || !plain) return undefined
  const keys = Object.keys(parsed.params)
  if (parsed.code !== "") return keys.length === 0 ? (BY_SIZE.get(parsed.code) ?? refuse(`the sizes are ${FORMS}`)) : undefined
  const letter = keys.length === 1 && parsed.params[keys[0] as string] === true ? BY_LETTER.get(keys[0] as string) : undefined
  return letter ?? refuse(`a tantalum capacitor is ${FORMS}`)
}

function nameOf(parsed: ParsedFootprint): string {
  return parsed.code === "" ? `tant_${Object.keys(parsed.params)[0]}` : `tant${parsed.code}`
}

/**
 * The footprint for a moulded tantalum capacitor on KEMET's level B lands, or undefined. Pad 1 is the anode
 * (+), at negative x, and a "+" on the silkscreen above it, as radial.ts marks its positive pad.
 */
export function tantalumFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  const found = caseOf(parsed)
  if (!found || "refused" in found) return found
  const { land } = found
  const centre = tidy((land.gap + land.length) / 2)
  const pads = [roundRectPad("1", -centre, 0, land.length, land.width), roundRectPad("2", centre, 0, land.length, land.width)]
  const body = { x: found.length.max / 2, y: found.width.max / 2 }
  const plus = plusMark(pads[0] as Pad)
  const plusTop = Math.max(...plus.flat().map((p) => Math.abs(p.y)))
  const component = { x: body.x, y: Math.max(body.y, plusTop) }
  return {
    name: nameOf(parsed),
    pads,
    courtyard: courtyard(pads, component, MOLDED_BODY_TABLE),
    silkscreen: [...sideLines(pads, body), ...plus],
    fabrication: bodyOutline(body),
    origin: `KEMET T491 data sheet (T2005_T491, 2026-07-08) Table 2 level B lands, moulded tantalum ${found.label}`,
  }
}
