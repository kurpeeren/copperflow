import { chipTable, IPC_TOLERANCES, landPattern, padRow, roundRectPad, type Range } from "./ipc7351.js"
import { bodyOutline, centredOffsets, courtyard, rowSilkscreen } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/**
 * A chip resistor array: `count` resistors side by side along x, a terminal at each end of each one
 * (bottom and top rows). Body length along x and width across the rows (the terminal span), terminal
 * length on the board and terminal width, pitch between terminals of one row.
 */
interface ArrayOutline {
  label: string
  count: number
  pitch: number
  bodyLength: Range
  span: Range
  terminal: Range
  terminalWidth: Range
}

const range = (min: number, max: number): Range => ({ min, max })

/**
 * Convex-terminal chip resistor arrays, written from general knowledge of makers' tables (Yageo
 * YC124/YC164/YC122, Panasonic EXB-28V/38V/24V), not transcribed from one drawing:
 * - 4 × 0603: body 3.0–3.4 × 1.4–1.8, pitch 0.8, terminal 0.2–0.5 long, 0.3–0.5 wide.
 * - 4 × 0402: body 1.9–2.1 × 0.9–1.1, pitch 0.5, terminal 0.15–0.35 long, 0.2–0.3 wide.
 * - 2 × 0402: body 0.9–1.1 × 0.9–1.1, pitch 0.65, terminal 0.15–0.35 long, 0.25–0.4 wide.
 * IPC-7351B has its own goals for chip arrays; no source for them was at hand, so the chip goals of
 * Tables 3-5 and 3-6 (chosen by the terminal span) are used.
 */
const ARRAYS = new Map<string, ArrayOutline>([
  ["4x0603", { label: "4 × 0603", count: 4, pitch: 0.8, bodyLength: range(3.0, 3.4), span: range(1.4, 1.8), terminal: range(0.2, 0.5), terminalWidth: range(0.3, 0.5) }],
  ["4x0402", { label: "4 × 0402", count: 4, pitch: 0.5, bodyLength: range(1.9, 2.1), span: range(0.9, 1.1), terminal: range(0.15, 0.35), terminalWidth: range(0.2, 0.3) }],
  ["2x0402", { label: "2 × 0402", count: 2, pitch: 0.65, bodyLength: range(0.9, 1.1), span: range(0.9, 1.1), terminal: range(0.15, 0.35), terminalWidth: range(0.25, 0.4) }],
])

function keyOf(parsed: ParsedFootprint): string | undefined {
  const plain = parsed.variant === undefined && parsed.suffix === undefined && parsed.size === undefined && parsed.pairs === undefined
  if (parsed.kind !== "array" || !plain || parsed.cross === undefined || Object.keys(parsed.params).length > 0) return undefined
  return `${parsed.code}x${parsed.cross}`
}

/** Pad 1 at the left of the bottom row, counter-clockwise: bottom row left to right, top row back. */
function arrayPads(outline: ArrayOutline): Pad[] {
  const table = chipTable(outline.span)
  const lead = { span: outline.span, terminal: outline.terminal, width: outline.terminalWidth }
  const row = padRow(landPattern(lead, table.goals, IPC_TOLERANCES), table.roundOff)
  const xs = centredOffsets(outline.count, outline.pitch)
  const bottom = xs.map((x, i) => roundRectPad(String(i + 1), x, -row.centre, row.width, row.length))
  const top = [...xs].reverse().map((x, i) => roundRectPad(String(outline.count + i + 1), x, row.centre, row.width, row.length))
  return [...bottom, ...top]
}

/** The IPC-7351B nominal footprint for "array4x0603", "array4x0402" or "array2x0402", or undefined. */
export function arrayFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const key = keyOf(parsed)
  const outline = key === undefined ? undefined : ARRAYS.get(key)
  if (!key || !outline) return undefined
  const pads = arrayPads(outline)
  const body = { x: outline.bodyLength.max / 2, y: outline.span.max / 2 }
  return {
    name: `array${key}`,
    pads,
    courtyard: courtyard(pads, body, chipTable(outline.span)),
    silkscreen: rowSilkscreen(pads, body),
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, chip resistor array ${outline.label}`,
  }
}
