// The Filter tab's rule: which kinds of thing a click, a box, a double click, the context menu and Select all may pick.
// A kind that is off still draws and stays reachable from the left panel. Plain TypeScript, so the tests can run it.
import type { View } from "./positions.js"

/** The kinds a pick can be limited to. Notes are not here: a note's mark is drawn but has no hit area on either canvas. */
export type PickKind = "parts" | "labels" | "wires"

/** Which kinds may be picked. */
export type PickFilter = Readonly<Record<PickKind, boolean>>

export const ALL_PICKABLE: PickFilter = { parts: true, labels: true, wires: true }

/** The filter with `kind` switched on or off, as a new value. */
export function togglePickKind(filter: PickFilter, kind: PickKind): PickFilter {
  return { ...filter, [kind]: !filter[kind] }
}

/** Whether a pick of this kind is allowed; no filter allows everything. */
export function kindPickable(filter: PickFilter | undefined, kind: PickKind): boolean {
  return filter === undefined || filter[kind]
}

/** The rows the Filter tab shows for a view: wires, net labels and flags exist only on the schematic. */
export function pickKindRows(view: View): ReadonlyArray<{ kind: PickKind; label: string }> {
  const parts = { kind: "parts" as const, label: "Parts" }
  return view === "schematic" ? [parts, { kind: "wires", label: "Wires" }, { kind: "labels", label: "Net labels and flags" }] : [parts]
}
