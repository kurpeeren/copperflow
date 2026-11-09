// What Delete does to the selection, parts, wires, net labels and drawings together: one change, so one history entry,
// that removes the selected wires' traces first, then the selected drawings, then the selected parts. A hand-drawn label is removed by removing its
// trace, through the wires' own removal, so its wire also selected is not removed twice; a label Studio placed on a
// pin goes only with its part. A wire whose trace ends on a part being removed is left to that part (core's removePart
// takes the part's traces with it), so no trace is removed twice. What cannot go is named in one note and the rest
// goes ahead. Pure; use-part-keys.ts sends it.
import type { Selection } from "../selection.js"
import type { DrawingsRemoval } from "./drawing-actions.js"
import { nameList, removeEach, removeQuestion, wireWords, type GroupEdit } from "./group-edits.js"
import type { LabelsRemoval } from "./label-selection.js"
import type { WiresRemoval } from "./wire-actions.js"

/** What Delete says with nothing selected. */
export const NOTHING_TO_DELETE = "Select a part or a wire first."

/** Delete's change, the wires and labels that leave the sheet with it, and the question asked first when parts go. */
export interface DeletePlan {
  plan: GroupEdit
  /** The wires the change takes away: those whose traces it removes and those that go with their parts. */
  wires: string[]
  /** The labels the change takes away: with their wires, or with their parts. */
  labels: string[]
  /** The drawings the change removes. */
  drawings: string[]
  /** Asked before parts go, since they take their connections; wires alone go without asking, as in EasyEDA. */
  question?: string
}

/**
 * How the selected wires are removed when `parts` go too (wire-actions.ts wiresRemoval), leaving out the reasons the
 * parts already gave (`said`); the PCB has none.
 */
export type RemoveWires = (ids: readonly string[], parts: ReadonlySet<string>, said: ReadonlySet<string>) => WiresRemoval

/** How the selected labels go when `parts` go too (label-selection.ts labelsRemoval); the PCB has none. */
export type RemoveLabels = (ids: readonly string[], parts: ReadonlySet<string>) => LabelsRemoval

/** How the selected drawings go (drawing-actions.ts drawingsRemoval); the PCB has none. */
export type RemoveDrawings = (ids: readonly string[]) => DrawingsRemoval

const unique = (items: readonly string[]): string[] => [...new Set(items)]

/** The selected labels the change takes away: those on a part that goes, and the hand-drawn ones whose wire goes. */
function labelsGone(labels: LabelsRemoval | undefined, wiresGone: ReadonlySet<string>): Set<string> {
  const withWires = labels?.withWires.filter((one) => wiresGone.has(one.wire)).map((one) => one.label) ?? []
  return new Set([...(labels?.withParts ?? []), ...withWires])
}

export function deletePlan(
  selection: Selection,
  blockerFor: (name: string) => string | null,
  removeWires?: RemoveWires,
  removeLabels?: RemoveLabels,
  removeDrawings?: RemoveDrawings,
): DeletePlan | { message: string } {
  if (selection.total === 0) return { message: NOTHING_TO_DELETE }
  const parts = removeEach(selection.names, blockerFor)
  const going = new Set(parts.parts)
  const labels = removeLabels && selection.labelCount > 0 ? removeLabels(selection.labels, going) : undefined
  const wireIds = unique([...selection.wires, ...(labels?.withWires.map((one) => one.wire) ?? [])])
  const wires = removeWires && wireIds.length > 0 ? removeWires(wireIds, going, new Set(parts.skipped)) : undefined
  const drawings = removeDrawings && selection.drawingCount > 0 ? removeDrawings(selection.drawings) : undefined
  const plan: GroupEdit = {
    edits: [...(wires?.edits ?? []), ...(drawings?.edits ?? []), ...parts.edits],
    summary: `remove ${nameList([...parts.parts, ...wireWords(wires?.names ?? []), ...(drawings?.names ?? [])])}`,
    parts: parts.parts,
    skipped: [...parts.skipped, ...(wires?.skipped ?? []), ...(labels?.skipped ?? []), ...(drawings?.skipped ?? [])],
    done: "removed",
  }
  const gone = new Set([...(wires?.removed ?? []), ...(wires?.withParts ?? [])])
  const goneLabels = labelsGone(labels, gone)
  return {
    plan,
    wires: selection.wires.filter((id) => gone.has(id)),
    labels: selection.labels.filter((id) => goneLabels.has(id)),
    drawings: drawings?.removed ?? [],
    // The question counts the wires selected; a selected label's wire is the label's, not "a wire".
    ...(parts.parts.length > 0 ? { question: removeQuestion(parts.parts, (wires?.removed ?? []).filter((id) => selection.hasWire(id)).length) } : {}),
  }
}
