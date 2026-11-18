import { IPC_TOLERANCES, landPattern, twoTerminalPads, type GoalTable, type Range } from "./ipc7351.js"
import { bodyOutline, cathodeBar, courtyard, sideLines } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import type { Footprint } from "./types.js"

/** A MELF cylinder: overall length L, diameter D and end cap length T. */
interface MelfOutline {
  label: string
  length: Range
  diameter: Range
  cap: Range
}

const range = (min: number, max: number): Range => ({ min, max })

/**
 * MiniMELF (SOD-80, DO-213AA): L 3.3–3.7, D 1.4–1.6, end cap 0.25–0.55. MELF (DO-213AB): L 4.8–5.2,
 * D 2.4–2.6, end cap 0.45–0.65. Written from general knowledge of diode and resistor makers' MELF
 * drawings, not transcribed from one drawing; a part's own drawing should confirm.
 */
const MINIMELF: MelfOutline = { label: "MiniMELF (SOD-80, DO-213AA)", length: range(3.3, 3.7), diameter: range(1.4, 1.6), cap: range(0.25, 0.55) }
const MELF: MelfOutline = { label: "MELF (DO-213AB)", length: range(4.8, 5.2), diameter: range(2.4, 2.6), cap: range(0.45, 0.65) }

/**
 * Cylindrical end-cap terminals (MELF), level B: toe 0.40, heel 0.20, side 0.10; round-off to the
 * nearest 0.05 mm; courtyard excess 0.25. Written from general knowledge of the IPC-7351B MELF table;
 * no source for that table was at hand, so they are not checked against it.
 */
const MELF_TABLE: Readonly<GoalTable> = Object.freeze({
  goals: Object.freeze({ toe: 0.4, heel: 0.2, side: 0.1 }),
  roundOff: 0.05,
  courtyardExcess: 0.25,
})

const OUTLINES = new Map<string, MelfOutline>([
  ["minimelf", MINIMELF],
  ["sod80", MINIMELF],
  ["do213aa", MINIMELF],
  ["melf", MELF],
  ["do213ab", MELF],
])

function keyOf(parsed: ParsedFootprint): string | undefined {
  const plain = parsed.variant === undefined && parsed.cross === undefined && parsed.size === undefined && parsed.pairs === undefined
  if (!plain || Object.keys(parsed.params).length > 0) return undefined
  return `${parsed.kind}${parsed.code}${parsed.suffix ?? ""}`
}

/**
 * The IPC-7351B nominal footprint for "minimelf" ("sod80", "do213aa") or "melf" ("do213ab"), or
 * undefined. As for the other diodes, pin 1 is the anode and pin 2 the cathode, so the silkscreen
 * cathode bar sits on the pad 2 side, at positive x.
 */
export function melfFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const key = keyOf(parsed)
  const outline = key === undefined ? undefined : OUTLINES.get(key)
  if (!key || !outline) return undefined
  const lead = { span: outline.length, terminal: outline.cap, width: outline.diameter }
  const pads = twoTerminalPads(landPattern(lead, MELF_TABLE.goals, IPC_TOLERANCES), MELF_TABLE.roundOff)
  const body = { x: outline.length.max / 2, y: outline.diameter.max / 2 }
  return {
    name: key,
    pads,
    courtyard: courtyard(pads, body, MELF_TABLE),
    silkscreen: [...sideLines(pads, body), cathodeBar(pads, body)],
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, ${outline.label}`,
  }
}
