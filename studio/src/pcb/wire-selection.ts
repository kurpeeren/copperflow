// The rules for selected wires outside the canvas: which wires the selection keeps as the design is rebuilt, and which
// selection the views and panels are shown. App.tsx follows them. Plain TypeScript with .js imports, so the tests can
// run it.
import type { Selection } from "../selection.js"
import type { Point } from "./geometry.js"
import type { View } from "./positions.js"

/** A wire as these rules see it: its id, its points, and the connection of a hand-drawn wire. */
export interface SheetWire {
  id: string
  points: readonly Point[]
  connection?: string
}

const sameSpot = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

/** Whether the two wires join the same two points, whichever way round. */
function sameEnds(a: readonly Point[], b: readonly Point[]): boolean {
  const [a0, a1, b0, b1] = [a[0], a[a.length - 1], b[0], b[b.length - 1]]
  if (!a0 || !a1 || !b0 || !b1) return false
  return (sameSpot(a0, b0) && sameSpot(a1, b1)) || (sameSpot(a0, b1) && sameSpot(a1, b0))
}

/** Whether a selected wire is gone after the build, or now names another wire. */
function goneAfterBuild(id: string, before: readonly SheetWire[] | undefined, after: readonly SheetWire[]): boolean {
  const now = after.find((wire) => wire.id === id)
  const then = before?.find((wire) => wire.id === id)
  if (!now) return true
  return now.connection === undefined && then !== undefined && !sameEnds(then.points, now.points)
}

/**
 * The selection after a build. A wire the sheet no longer draws goes (deleted, undone), so it is not selected again
 * when it comes back. A wire Studio draws on its own is named by its place among its net's wires, so it also goes when
 * that id now joins other ends; a hand-drawn wire's id names its trace, so it stays wherever its ends went. The parts
 * and the other wires stay.
 */
export function wireAfterBuild(selection: Selection, before: readonly SheetWire[] | undefined, after: readonly SheetWire[]): Selection {
  return selection.withoutWires(selection.wires.filter((id) => goneAfterBuild(id, before, after)))
}

/**
 * What the canvases and panels are shown: the selection less any part the loaded circuit does not have (yet), and less
 * the wires the open sheet does not draw. The PCB shows no wire, so the wires selected on the schematic wait there.
 */
export function shownSelection(selection: Selection, sheet: { view: View; parts?: Iterable<string>; wires?: Iterable<string> }): Selection {
  const kept = sheet.parts ? selection.keep(sheet.parts) : selection
  return kept.keepWires(sheet.view === "schematic" ? (sheet.wires ?? []) : [])
}
