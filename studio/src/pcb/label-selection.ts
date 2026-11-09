// The selected net labels and flags as the design is rebuilt. A move or a drag can give a label a new id: one Studio
// placed on a pin (`label:<net id>:<pin id>`) becomes the end of a hand-drawn wire (`label:<connection id>`), and
// back. Such a label stays selected under its new id, in its place in the list; one the sheet no longer draws goes, so
// it is not selected again when it comes back. App.tsx follows this. Delete on labels and the Properties of one label
// are worked out here too. Plain TypeScript with .js imports, so the tests can run it.
import type { Design } from "../../../src/engine/design.js"
import type { Selection } from "../selection.js"
import { netLabel } from "../net-rows.js"
import { canonicalNet } from "./highlight.js"
import { labelHolder, labelKey } from "./label-drag.js"
import { namedLabelReason } from "./label-follow.js"

/** The id the label has after the build: the same, else the one with its net and pin, else none. */
function idAfter(id: string, before: Design | undefined, after: Design, drawn: ReadonlySet<string>): string | undefined {
  if (drawn.has(id)) return id
  const key = before && labelKey(before, id)
  return key === undefined ? undefined : after.schematic.labels.find((label) => labelKey(after, label.id) === key)?.id
}

/** The selection after a build: each selected label under its id in the new design, those gone dropped; the parts and wires stay. */
export function labelAfterBuild(selection: Selection, before: Design | undefined, after: Design): Selection {
  if (selection.labelCount === 0) return selection
  const drawn = new Set(after.schematic.labels.map((label) => label.id))
  const labels = selection.labels.flatMap((id) => idAfter(id, before, after, drawn) ?? [])
  return selection.all(selection.names, selection.wires, labels, selection.drawings)
}

/** What Delete does to the selected labels: the hand-drawn ones with their wires, those on a pin of a part that goes, and why the others stay. */
export interface LabelsRemoval {
  /** Each hand-drawn label with its wire: removing the label is removing its trace (the pin leaves the net). */
  withWires: { label: string; wire: string }[]
  /** Labels Studio placed on a pin of a part that goes: the part takes them. */
  withParts: string[]
  skipped: string[]
}

/** The pin a label Studio placed sits on, from its id `label:<net id>:<pin id>`. */
const placedPin = (id: string, net: string): string => id.slice(`label:${net}:`.length)

type LabelOutcome = { kind: "wire"; label: string; wire: string } | { kind: "part"; label: string } | { kind: "skipped"; reason: string } | { kind: "gone" }

function labelOutcome(design: Design, id: string, parts: ReadonlySet<string>): LabelOutcome {
  const label = design.schematic.labels.find((candidate) => candidate.id === id)
  const holder = labelHolder(design, id)
  if (holder?.wire !== undefined) return { kind: "wire", label: id, wire: holder.wire }
  if (holder && parts.has(holder.part)) return { kind: "part", label: id }
  if (!label) return { kind: "gone" }
  return { kind: "skipped", reason: namedLabelReason(label, `Studio places it on ${placedPin(id, label.net)} for its net; delete that pin's part or wire instead`) }
}

/**
 * Delete on labels while `parts` go too: a hand-drawn label goes with its trace (its wire, removed through the wires'
 * own removal, so a wire also selected is not removed twice); a label Studio placed on a pin goes only with its part,
 * and otherwise is named, since it has no trace of its own.
 */
export function labelsRemoval(design: Design, ids: readonly string[], parts: ReadonlySet<string>): LabelsRemoval {
  const outcomes = ids.map((id) => labelOutcome(design, id, parts))
  return {
    withWires: outcomes.flatMap((outcome) => (outcome.kind === "wire" ? [{ label: outcome.label, wire: outcome.wire }] : [])),
    withParts: outcomes.flatMap((outcome) => (outcome.kind === "part" ? [outcome.label] : [])),
    skipped: outcomes.flatMap((outcome) => (outcome.kind === "skipped" ? [outcome.reason] : [])),
  }
}

/** The Properties of one selected label: its net (for Highlight net) and its rows. */
export interface LabelProperties {
  net: string
  rows: { label: string; value: string }[]
}

/** Net, text and kind of a label: at a pin (Studio places it there) or hand-drawn (it ends a wire); undefined for a label gone. */
export function labelProperties(design: Design, labelId: string): LabelProperties | undefined {
  const label = design.schematic.labels.find((candidate) => candidate.id === labelId)
  if (!label) return undefined
  const net = canonicalNet(design.circuit.nets, label.net)
  const found = design.circuit.nets.find((candidate) => candidate.id === net)
  const kind = labelHolder(design, labelId)?.wire === undefined ? "At a pin" : "Hand-drawn"
  const rows = [
    { label: "Net", value: found ? netLabel(found) : net.replace(/^net\./, "") },
    { label: "Text", value: label.text },
    { label: "Kind", value: kind },
  ]
  return { net, rows }
}
