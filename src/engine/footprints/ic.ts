import {
  gullWingGoals,
  gullWingTable,
  IPC_TOLERANCES,
  landPattern,
  padRow,
  QFN_TABLE,
  type GoalTable,
  type PadRow,
  type Range,
} from "./ipc7351.js"
import type { ParsedFootprint } from "./parse.js"

/** An IC package as its outline drawing gives it. Lengths in mm. */
export interface IcPackage {
  /** For `origin`, e.g. "SOIC-8". */
  label: string
  /** Between neighbouring leads of one row. */
  pitch: number
  /** Across two opposite rows, toe to toe (HE, E, HD). For a no-lead package, the body. */
  span: Range
  /** The part of the lead or terminal that lies on the board (L, Lp). */
  terminal: Range
  /** Lead or terminal width (b, bp). */
  leadWidth: Range
  /** The body between two opposite rows, measured along the leads: Amax of IPC-7351B Table 3-2 Note 1. */
  bodyAcross: Range
  /** The body measured along a row. */
  bodyAlong: Range
}

export const range = (min: number, max: number): Range => ({ min, max })

/** A row of pads and the IPC-7351B table it came from (for round-off and courtyard). */
export interface IcRow {
  row: PadRow
  table: Readonly<GoalTable>
}

function leadOf(pkg: IcPackage) {
  return { span: pkg.span, terminal: pkg.terminal, width: pkg.leadWidth }
}

/** Gull-wing leads: IPC-7351B Table 3-2 or 3-3 by pitch, with Note 1 against the body across the leads. */
export function gullWingRow(pkg: IcPackage): IcRow {
  const table = gullWingTable(pkg.pitch)
  const goals = gullWingGoals(leadOf(pkg), pkg.bodyAcross.max, table)
  return { row: padRow(landPattern(leadOf(pkg), goals, IPC_TOLERANCES), table.roundOff), table }
}

/** No-lead terminals that end at the body edge: IPC-7351B Table 3-15, with the body as the span. */
export function leadlessRow(pkg: IcPackage): IcRow {
  return { row: padRow(landPattern(leadOf(pkg), QFN_TABLE.goals, IPC_TOLERANCES), QFN_TABLE.roundOff), table: QFN_TABLE }
}

const SAME = 1e-6
const nominal = (r: Range) => (r.min + r.max) / 2

/**
 * `_p` and `_w` may only confirm the package: `_p` its pitch, `_w` its nominal span. `flags` lists
 * the bare flags (such as `ep`) the family accepts; anything else refuses the string.
 */
export function confirmsPackage(params: ParsedFootprint["params"], pkg: IcPackage, flags: readonly string[] = []): boolean {
  return Object.entries(params).every(([key, value]) => {
    if (key === "p") return value !== true && Math.abs(value - pkg.pitch) < SAME
    if (key === "w") return value !== true && Math.abs(value - nominal(pkg.span)) < SAME
    return flags.includes(key) && value === true
  })
}
