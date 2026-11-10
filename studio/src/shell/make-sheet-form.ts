// Edit → Make sub-sheet…: whether the selection can become a sub-sheet, and the dialog's lists as rows: the ports it
// will make and the designators before and after. Pure; plain TypeScript with .js imports, so the tests can run it.
import type { MakeSheetPreview } from "../../../src/core/make-sheet.js"
import { cutRefusal } from "../../../src/core/sheet-cut.js"
import type { CircuitModel } from "../../../src/core/types.js"

export type { MakeSheetPreview }

/** The parts the dialog will move, or why it does not open. */
export function makeSheetStart(model: CircuitModel | undefined, names: readonly string[]): { parts: string[] } | { message: string } {
  if (!model) return { message: "Wait for the circuit to load, then try again." }
  const refusal = cutRefusal(model, names)
  return refusal === undefined ? { parts: [...new Set(names)] } : { message: refusal }
}

export interface PortRow {
  port: string
  /** What it connects to on the page: "net VIN", or "bus D[0:3]". */
  joins: string
}

/** One row per port, in the order the sheet writes them. */
export function portRows(preview: MakeSheetPreview): PortRow[] {
  return preview.ports.map((port) => ({ port: port.name, joins: `${port.bus ? "bus" : "net"} ${preview.connections[port.name] ?? port.name}` }))
}

export interface DesignatorRow {
  now: string
  /** In the sheet file. */
  sheet: string
  /** In the built design: the sheet's designator with the base added. */
  board: string
}

export function designatorRows(preview: MakeSheetPreview): DesignatorRow[] {
  return preview.mapping.map((m) => ({ now: m.from, sheet: m.to, board: m.flat }))
}

/** What the sheet name field says while it is empty. */
export const SHEET_NAME_HINT = "Type the sheet's name, e.g. PowerStage: a capital letter, then letters, digits and _."

/** The note after the change is written. */
export function madeNote(preview: MakeSheetPreview, parts: number): string {
  return `Made ${preview.file}: ${preview.instance} (base ${preview.base}) replaces ${parts} part${parts === 1 ? "" : "s"}`
}
