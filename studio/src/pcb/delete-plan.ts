// What Delete does to the selection, parts and wires together: one change, so one history entry, that removes the
// selected wires' traces first and then the selected parts. A wire whose trace ends on a part being removed is left to
// that part (core's removePart takes the part's traces with it), so no trace is removed twice. What cannot go is named
// in one note and the rest goes ahead. Pure; use-part-keys.ts sends it.
import type { Selection } from "../selection.js"
import { nameList, removeEach, removeQuestion, wireWords, type GroupEdit } from "./group-edits.js"
import type { WiresRemoval } from "./wire-actions.js"

/** What Delete says with nothing selected. */
export const NOTHING_TO_DELETE = "Select a part or a wire first."

/** Delete's change, the wires that leave the sheet with it, and the question asked first when parts go. */
export interface DeletePlan {
  plan: GroupEdit
  /** The wires the change takes away: those whose traces it removes and those that go with their parts. */
  wires: string[]
  /** Asked before parts go, since they take their connections; wires alone go without asking, as in EasyEDA. */
  question?: string
}

/** How the selected wires are removed when `parts` go too (wire-actions.ts wiresRemoval); the PCB has none. */
export type RemoveWires = (ids: readonly string[], parts: ReadonlySet<string>) => WiresRemoval

export function deletePlan(selection: Selection, blockerFor: (name: string) => string | null, removeWires?: RemoveWires): DeletePlan | { message: string } {
  if (selection.total === 0) return { message: NOTHING_TO_DELETE }
  const parts = removeEach(selection.names, blockerFor)
  const wires = removeWires && selection.wireCount > 0 ? removeWires(selection.wires, new Set(parts.parts)) : undefined
  const plan: GroupEdit = {
    edits: [...(wires?.edits ?? []), ...parts.edits],
    summary: `remove ${nameList([...parts.parts, ...wireWords(wires?.names ?? [])])}`,
    parts: parts.parts,
    skipped: [...parts.skipped, ...(wires?.skipped ?? [])],
    done: "removed",
  }
  const gone = [...(wires?.removed ?? []), ...(wires?.withParts ?? [])]
  const ordered = selection.wires.filter((id) => gone.includes(id))
  return { plan, wires: ordered, ...(parts.parts.length > 0 ? { question: removeQuestion(parts.parts, wires?.removed.length ?? 0) } : {}) }
}
