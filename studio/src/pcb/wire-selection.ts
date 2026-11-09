// The rules for selected wires outside the canvas: which wires the selection keeps as the design is rebuilt, and which
// selection the views and panels are shown. App.tsx follows them. Plain TypeScript with .js imports, so the tests can
// run it.
import type { Selection } from "../selection.js"
import type { Point } from "./geometry.js"
import type { View } from "./positions.js"

/** A wire as these rules see it: its id, its points, the connection of a hand-drawn wire, and the pins a wire Studio draws joins. */
export interface SheetWire {
  id: string
  points: readonly Point[]
  connection?: string
  ends?: readonly string[]
}

const spot = (p: Point): string => `${p.x},${p.y}`

/** The sheet's wires, each wire Studio draws with the pins at its two ends (withEndPins), so a moved part does not lose it. */
export function withEndPins(sheet: { wires: readonly SheetWire[]; symbols: readonly { pinEnds: Record<string, Point> }[] }): SheetWire[] {
  const pins = new Map(sheet.symbols.flatMap((symbol) => Object.entries(symbol.pinEnds).map(([pin, at]) => [spot(at), pin] as const)))
  return sheet.wires.map((wire) => {
    const [first, last] = [wire.points[0], wire.points[wire.points.length - 1]]
    const ends = first && last ? [pins.get(spot(first)), pins.get(spot(last))] : []
    const both = ends.length === 2 && ends.every((pin) => pin !== undefined)
    return wire.connection === undefined && both ? { ...wire, ends: ends as string[] } : wire
  })
}

const sameSpot = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

/** Whether the two wires join the same two pins (when both name them), else the same two points, whichever way round. */
function sameEnds(a: SheetWire, b: SheetWire): boolean {
  if (a.ends && b.ends) return a.ends.length === b.ends.length && a.ends.every((pin) => b.ends?.includes(pin))
  const [a0, a1, b0, b1] = [a.points[0], a.points[a.points.length - 1], b.points[0], b.points[b.points.length - 1]]
  if (!a0 || !a1 || !b0 || !b1) return false
  return (sameSpot(a0, b0) && sameSpot(a1, b1)) || (sameSpot(a0, b1) && sameSpot(a1, b0))
}

/** Whether a selected wire is gone after the build, or now names another wire. */
function goneAfterBuild(id: string, before: readonly SheetWire[] | undefined, after: readonly SheetWire[]): boolean {
  const now = after.find((wire) => wire.id === id)
  const then = before?.find((wire) => wire.id === id)
  if (!now) return true
  return now.connection === undefined && then !== undefined && !sameEnds(then, now)
}

/**
 * The selection after a build. A wire the sheet no longer draws goes (deleted, undone), so it is not selected again
 * when it comes back. A wire Studio draws on its own is named by its place among its net's wires, so it also goes when
 * that id now joins other pins (or, without its pins, other points); a hand-drawn wire's id names its trace, so it
 * stays wherever its ends went. The parts and the other wires stay.
 */
export function wireAfterBuild(selection: Selection, before: readonly SheetWire[] | undefined, after: readonly SheetWire[]): Selection {
  return selection.withoutWires(selection.wires.filter((id) => goneAfterBuild(id, before, after)))
}

/** What the open view draws: its view, the circuit's parts, and on the schematic the sheet's wires, labels and drawings. */
export interface ShownSheet {
  view: View
  parts?: Iterable<string>
  wires?: Iterable<string>
  labels?: Iterable<string>
  drawings?: Iterable<string>
  /** On the PCB: the tracks and vias of the layout file. */
  copper?: Iterable<string>
}

/**
 * What the canvases and panels are shown: the selection less any part the loaded circuit does not have (yet), and less
 * the wires, labels and drawings the open sheet does not draw, and the copper the PCB does not have. The PCB shows no
 * wire, label or drawing, so those selected on the schematic wait there; copper selected on the PCB waits likewise
 * while the schematic is open.
 */
export function shownSelection(selection: Selection, sheet: ShownSheet): Selection {
  const kept = sheet.parts ? selection.keep(sheet.parts) : selection
  const onSheet = sheet.view === "schematic"
  const drawn = (ids: Iterable<string> | undefined): Iterable<string> => (onSheet ? (ids ?? []) : [])
  const copper = onSheet ? [] : (sheet.copper ?? [])
  return kept.keepWires(drawn(sheet.wires)).keepLabels(drawn(sheet.labels)).keepDrawings(drawn(sheet.drawings)).keepCopper(copper)
}
