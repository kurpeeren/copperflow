import type { Diagnostic, Point } from "../model.js"
import type { PcbLayout } from "../pcb.js"
import { violation, type Violation } from "./violation.js"

/** The codes of the findings copper.ts makes about how copper joins pads; the checks report them as violations. */
export const COPPER_NOTE_CODES: ReadonlySet<string> = new Set(["short", "floating", "mismatch", "copper-layer"])

export const isCopperNote = (d: Diagnostic): boolean => COPPER_NOTE_CODES.has(d.code)

/** Where a piece of copper starts: a track's first point, a via's centre. */
function copperAt(layout: PcbLayout, ids: readonly string[]): Point | undefined {
  const starts = new Map<string, Point | undefined>([...layout.tracks.map((t) => [t.id, t.points[0]] as const), ...layout.vias.map((v) => [v.id, v.at] as const)])
  return ids.map((id) => starts.get(id)).find((p) => p !== undefined)
}

/**
 * The short, floating, mismatch and copper-layer findings as PCB violations with the same code, severity, message
 * and items, pointing at the first copper they name. Other diagnostics are left out.
 */
export function copperNoteChecks(notes: readonly Diagnostic[], layout: PcbLayout): Violation[] {
  return notes.filter(isCopperNote).map((note) => violation(note.code, note.severity, note.message, note.items, "pcb", copperAt(layout, note.items)))
}
