// The rules for a selected wire outside the canvas: which wire the selection keeps as the design is rebuilt, which
// selection the views and panels are shown, and what Delete removes. App.tsx and the part keys follow them. Plain
// TypeScript with .js imports, so the tests can run it.
import type { Selection } from "../selection.js"
import type { Point } from "./geometry.js"
import type { View } from "./positions.js"

/** A wire as these rules see it: its id, its points, and the connection of a hand-drawn wire. */
export interface SheetWire {
  id: string
  points: readonly Point[]
  connection?: string
}

/** What Delete says with nothing selected. */
export const NOTHING_TO_DELETE = "Select a part or a wire first."

/** What Delete acts on: the selected wire, else the selected parts, else nothing (and what to tell). */
export type DeleteTarget = { kind: "wire"; id: string } | { kind: "parts"; names: readonly string[] } | { kind: "nothing"; message: string }

export function deleteTarget(selection: Selection): DeleteTarget {
  if (selection.wire !== undefined) return { kind: "wire", id: selection.wire }
  return selection.size > 0 ? { kind: "parts", names: selection.names } : { kind: "nothing", message: NOTHING_TO_DELETE }
}

const sameSpot = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

/** Whether the two wires join the same two points, whichever way round. */
function sameEnds(a: readonly Point[], b: readonly Point[]): boolean {
  const [a0, a1, b0, b1] = [a[0], a[a.length - 1], b[0], b[b.length - 1]]
  if (!a0 || !a1 || !b0 || !b1) return false
  return (sameSpot(a0, b0) && sameSpot(a1, b1)) || (sameSpot(a0, b1) && sameSpot(a1, b0))
}

/**
 * The selection after a build. A wire the sheet no longer draws goes (deleted, undone), so it is not selected again
 * when it comes back. A wire Studio draws on its own is named by its place among its net's wires, so it also goes when
 * that id now joins other ends; a hand-drawn wire's id names its trace, so it stays wherever its ends went.
 */
export function wireAfterBuild(selection: Selection, before: readonly SheetWire[] | undefined, after: readonly SheetWire[]): Selection {
  const id = selection.wire
  if (id === undefined) return selection
  const now = after.find((wire) => wire.id === id)
  const then = before?.find((wire) => wire.id === id)
  if (!now) return selection.clear()
  const repointed = now.connection === undefined && then !== undefined && !sameEnds(then.points, now.points)
  return repointed ? selection.clear() : selection
}

/**
 * What the canvases and panels are shown: the selection less any part the loaded circuit does not have (yet), and less
 * a wire the open sheet does not draw. The PCB shows no wire, so a wire selected on the schematic waits there.
 */
export function shownSelection(selection: Selection, sheet: { view: View; parts?: Iterable<string>; wires?: Iterable<string> }): Selection {
  const kept = sheet.parts ? selection.keep(sheet.parts) : selection
  return kept.keepWire(sheet.view === "schematic" ? (sheet.wires ?? []) : [])
}
