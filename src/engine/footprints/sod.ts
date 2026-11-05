import { GULL_WING_TABLE, gullWingGoals, IPC_TOLERANCES, landPattern, twoTerminalPads, type Range } from "./ipc7351.js"
import { bodyOutline, cathodeBar, courtyard, sideLines } from "./outline.js"
import type { Footprint } from "./types.js"

/** A small outline diode: toe-to-toe span He, lead foot length L, lead width b, body E × D. */
interface SodOutline {
  label: string
  span: Range
  terminal: Range
  leadWidth: Range
  bodyLength: Range
  bodyWidth: Range
}

const range = (min: number, max: number): Range => ({ min, max })

/**
 * Diodes Incorporated package information, table "Package Outline Dimensions" on page 1 of each:
 * - "SOD123 Package Information", Rev. 2017-03-16, https://www.diodes.com/assets/Package-Files/SOD123.pdf
 * - "SOD323 Package Information", Rev. 2017-03-16, https://www.diodes.com/assets/Package-Files/SOD323.pdf
 * He is the span, L the lead foot, b the lead width, E the body length and D the body width (min–max).
 * Both have gull-wing leads, so IPC-7351B Table 3-2 applies.
 *
 * SOD-523 is pending: its leads are flat, which IPC-7351B files as SODFL (section 8.13) with goals in
 * its Table 3-22. No available source reproduces that table, so "sod523" is refused until it is
 * sourced.
 */
const SODS: Readonly<Record<string, SodOutline>> = {
  "123": {
    label: "SOD-123",
    span: range(3.55, 3.85),
    terminal: range(0.25, 0.4),
    leadWidth: range(0.52, 0.62),
    bodyLength: range(2.55, 2.85),
    bodyWidth: range(1.4, 1.7),
  },
  "323": {
    label: "SOD-323",
    span: range(2.3, 2.7),
    terminal: range(0.2, 0.4),
    leadWidth: range(0.25, 0.35),
    bodyLength: range(1.6, 1.8),
    bodyWidth: range(1.2, 1.4),
  },
}

/**
 * The IPC-7351B nominal footprint for "sod" + code, such as "123", or undefined. Pin 1 is the anode
 * and pin 2 the cathode, so the silkscreen cathode bar sits on the pad 2 side, at positive x.
 * Amax for Table 3-2 Note 1 is the body length between the two leads; see `gullWingGoals` for how
 * that reading was settled.
 */
export function sodFootprint(code: string): Footprint | undefined {
  if (!Object.hasOwn(SODS, code)) return undefined
  const sod = SODS[code] as SodOutline
  const lead = { span: sod.span, terminal: sod.terminal, width: sod.leadWidth }
  const goals = gullWingGoals(lead, sod.bodyLength.max)
  const pads = twoTerminalPads(landPattern(lead, goals, IPC_TOLERANCES), GULL_WING_TABLE.roundOff)
  const body = { x: sod.bodyLength.max / 2, y: sod.bodyWidth.max / 2 }
  const component = {
    x: Math.max(sod.span.max, sod.bodyLength.max) / 2,
    y: Math.max(sod.bodyWidth.max, sod.leadWidth.max) / 2,
  }
  return {
    name: `sod${code}`,
    pads,
    courtyard: courtyard(pads, component, GULL_WING_TABLE),
    silkscreen: [...sideLines(pads, body), cathodeBar(pads, body)],
    fabrication: bodyOutline(body),
    origin: `IPC-7351B nominal, ${sod.label}`,
  }
}
