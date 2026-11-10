import { IPC_TOLERANCES, landPattern, MOLDED_BODY_TABLE, twoTerminalPads, type Range } from "./ipc7351.js"
import { bodyOutline, cathodeBar, courtyard, sideLines } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import type { Footprint } from "./types.js"

/** A DO-214 diode: span He (toe to toe), the terminal foot L, its width b, and the body. */
interface MoldedOutline {
  label: string
  span: Range
  terminal: Range
  leadWidth: Range
  bodyLength: Range
  bodyWidth: Range
}

const range = (min: number, max: number): Range => ({ min, max })

/**
 * JEDEC DO-214AC (SMA), DO-214AA (SMB) and DO-214AB (SMC), in the inch-controlled dimensions that
 * diode makers' outline drawings commonly give (converted to mm): overall length He, terminal foot
 * L 0.76–1.52, terminal width b, body length (along the terminals) and body width. Written from
 * general knowledge of those drawings, not transcribed from one; a part's own drawing should confirm.
 */
const SMA: MoldedOutline = {
  label: "DO-214AC (SMA)",
  span: range(4.93, 5.28),
  terminal: range(0.76, 1.52),
  leadWidth: range(1.25, 1.65),
  bodyLength: range(3.99, 4.5),
  bodyWidth: range(2.54, 2.79),
}
const SMB: MoldedOutline = {
  label: "DO-214AA (SMB)",
  span: range(5.21, 5.59),
  terminal: range(0.76, 1.52),
  leadWidth: range(1.95, 2.2),
  bodyLength: range(4.06, 4.57),
  bodyWidth: range(3.3, 3.94),
}
const SMC: MoldedOutline = {
  label: "DO-214AB (SMC)",
  span: range(7.75, 8.13),
  terminal: range(0.76, 1.52),
  leadWidth: range(2.9, 3.2),
  bodyLength: range(6.6, 7.11),
  bodyWidth: range(5.59, 6.22),
}

/** "sma", "smb", "smc" and their JEDEC names "do214ac", "do214aa", "do214ab". */
const OUTLINES = new Map<string, MoldedOutline>([
  ["sma", SMA],
  ["smb", SMB],
  ["smc", SMC],
  ["do214ac", SMA],
  ["do214aa", SMB],
  ["do214ab", SMC],
])

function keyOf(parsed: ParsedFootprint): string | undefined {
  const plain = parsed.variant === undefined && parsed.cross === undefined && parsed.size === undefined && parsed.pairs === undefined
  if (!plain || Object.keys(parsed.params).length > 0) return undefined
  return `${parsed.kind}${parsed.code}${parsed.suffix ?? ""}`
}

/**
 * The IPC-7351B nominal footprint for a DO-214 diode, or undefined. As for the SOD packages, pin 1
 * is the anode and pin 2 the cathode, so the silkscreen cathode bar sits on the pad 2 side, at
 * positive x.
 */
export function moldedFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const key = keyOf(parsed)
  const outline = key === undefined ? undefined : OUTLINES.get(key)
  if (!key || !outline) return undefined
  const lead = { span: outline.span, terminal: outline.terminal, width: outline.leadWidth }
  const pads = twoTerminalPads(landPattern(lead, MOLDED_BODY_TABLE.goals, IPC_TOLERANCES), MOLDED_BODY_TABLE.roundOff)
  const body = { x: outline.bodyLength.max / 2, y: outline.bodyWidth.max / 2 }
  const component = { x: outline.span.max / 2, y: Math.max(outline.bodyWidth.max, outline.leadWidth.max) / 2 }
  return {
    name: key,
    pads,
    courtyard: courtyard(pads, component, MOLDED_BODY_TABLE),
    silkscreen: [...sideLines(pads, body), cathodeBar(pads, body)],
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, ${outline.label}`,
  }
}
