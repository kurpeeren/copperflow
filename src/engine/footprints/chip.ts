import { chipTable, IPC_TOLERANCES, landPattern, twoTerminalPads, type Range } from "./ipc7351.js"
import { bodyOutline, courtyard, sideLines } from "./outline.js"
import type { Footprint } from "./types.js"

/** A two-terminal chip: body length L, body width W and terminal (band) length T. */
interface ChipSize {
  length: Range
  width: Range
  terminal: Range
}

/** nominal ± tolerance, without floating-point noise. */
function pm(nominal: number, tolerance: number): Range {
  const clean = (value: number) => Math.round(value * 1e6) / 1e6
  return { min: clean(nominal - tolerance), max: clean(nominal + tolerance) }
}

/**
 * KEMET, "Surface Mount Multilayer Ceramic Chip Capacitors (SMD MLCCs), C0G Dielectric, 10 – 250 VDC
 * (Commercial Grade)", C1003_C0G, 8/21/2023, page 3, table "Dimensions – Millimeters (Inches)":
 * L length, W width and B bandwidth (the terminal), keyed by EIA size code. Capacitor tolerances
 * are wider than resistor ones, so the pads also suit resistors of the same size.
 */
const KEMET_SIZES: Readonly<Record<string, ChipSize>> = {
  "0201": { length: pm(0.6, 0.03), width: pm(0.3, 0.03), terminal: pm(0.15, 0.05) },
  "0402": { length: pm(1.0, 0.05), width: pm(0.5, 0.05), terminal: pm(0.3, 0.1) },
  "0603": { length: pm(1.6, 0.15), width: pm(0.8, 0.15), terminal: pm(0.35, 0.15) },
  "0805": { length: pm(2.0, 0.2), width: pm(1.25, 0.2), terminal: pm(0.5, 0.25) },
  "1206": { length: pm(3.2, 0.2), width: pm(1.6, 0.2), terminal: pm(0.5, 0.25) },
  "1210": { length: pm(3.2, 0.2), width: pm(2.5, 0.2), terminal: pm(0.5, 0.25) },
  "1812": { length: pm(4.5, 0.3), width: pm(3.2, 0.3), terminal: pm(0.6, 0.35) },
}

/**
 * KEMET makes no 2010 or 2512 capacitor. Vishay, "D/CRCW e3 Standard Thick Film Chip Resistors",
 * document number 20035, revision 14-Apr-2026, page 11, table "Dimensions and mass": L, W and the
 * top and bottom terminal lengths T1 and T2 (both 0.6 ± 0.20).
 * https://www.vishay.com/docs/20035/dcrcwe3.pdf
 */
const VISHAY_SIZES: Readonly<Record<string, ChipSize>> = {
  "2010": { length: pm(5.0, 0.15), width: pm(2.5, 0.15), terminal: pm(0.6, 0.2) },
  "2512": { length: pm(6.3, 0.2), width: pm(3.15, 0.15), terminal: pm(0.6, 0.2) },
}

const CHIP_SIZES: Readonly<Record<string, ChipSize>> = { ...KEMET_SIZES, ...VISHAY_SIZES }

/** The IPC-7351B nominal footprint for an EIA chip size such as "0603", or undefined. */
export function chipFootprint(code: string): Footprint | undefined {
  if (!Object.hasOwn(CHIP_SIZES, code)) return undefined
  const size = CHIP_SIZES[code] as ChipSize
  const lead = { span: size.length, terminal: size.terminal, width: size.width }
  const table = chipTable(size.length)
  const pads = twoTerminalPads(landPattern(lead, table.goals, IPC_TOLERANCES), table.roundOff)
  const body = { x: size.length.max / 2, y: size.width.max / 2 }
  return {
    name: code,
    pads,
    courtyard: courtyard(pads, body, table),
    silkscreen: sideLines(pads, body),
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, EIA ${code}`,
  }
}
