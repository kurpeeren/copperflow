// Net labels and ground or power flags moved with a selection, as in EasyEDA: everything a box takes moves together.
// What a selected label needs depends on what holds it (label-drag.ts labelHolder):
// - a hand-drawn label (the last corner of a pin-to-net wire) whose wire the move carries, or whose part moves, rides
//   on that wire: the wire is carried whole with its label end (wire-follow.ts), one edit for the trace;
// - a label Studio placed on a pin of a moved part sits on the pin and needs nothing;
// - any other label moves on its own by the offset, through a label drag's own edit (labelDragEdits): a hand-drawn
//   one with its wire's end, a placed one with a short pin-to-net wire to its new place.
// Pure; wire-follow.ts withMovedWires puts these edits into the move's edit list, so the move stays one history entry.
import type { Edit } from "../../../src/core/types.js"
import type { Design } from "../../../src/engine/design.js"
import type { NetLabel } from "../../../src/engine/schematic.js"
import { roundPosition, type Point } from "./geometry.js"
import { labelDragEdits, labelHolder, labelName, labelPreview, type LabelMove } from "./label-drag.js"
import type { SourceCircuit } from "./positions.js"

/** How the selected labels go with a move. */
export interface LabelSort {
  /** The hand-drawn wires carried whole for their selected label, which goes with the wire's end: wire id to label id. */
  riding: ReadonlyMap<string, string>
  /** Labels on a pin of a moved part. */
  onPins: readonly string[]
  /** Labels moved on their own (ownLabelMoves). */
  alone: readonly string[]
}

/** Sorts the selected labels by what holds them; `moving` says whether a part moves, `carried` lists the selected wires. */
export function sortLabels(design: Design, labels: readonly string[], moving: (part: string) => boolean, carried: readonly string[]): LabelSort {
  const riding = new Map<string, string>()
  const onPins: string[] = []
  const alone: string[] = []
  for (const id of labels) {
    const holder = labelHolder(design, id)
    if (holder?.wire !== undefined && (carried.includes(holder.wire) || moving(holder.part))) riding.set(holder.wire, id)
    else if (holder && holder.wire === undefined && moving(holder.part)) onPins.push(id)
    else alone.push(id)
  }
  return { riding, onPins, alone }
}

/** What the labels moved on their own add to the move: their edits, how they are drawn until the build lands, their names, and why the others stay. */
export interface OwnLabelMoves {
  edits: Edit[]
  shown: LabelMove[]
  names: string[]
  notes: string[]
}

const labelOf = (design: Design, id: string): NetLabel | undefined => design.schematic.labels.find((label) => label.id === id)

/** The label's sentence among those left out: "The OUT label: R3 is locked". */
export function namedLabelReason(label: NetLabel | undefined, reason: string): string {
  const name = label ? labelName(label) : "the label"
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}: ${reason}`
}

/** One label moved on its own by `offset`; a reason a part already gave (its lock) is not said again. */
function ownMove(design: Design, source: SourceCircuit, id: string, offset: Point, locked: ReadonlySet<string>, said: readonly string[]): OwnLabelMoves {
  const label = labelOf(design, id)
  const none: OwnLabelMoves = { edits: [], shown: [], names: [], notes: [] }
  if (!label) return none
  const drop = { x: roundPosition(label.at.x + offset.x), y: roundPosition(label.at.y + offset.y) }
  const edits = labelDragEdits(design, source, id, drop, locked)
  if (!Array.isArray(edits)) return said.includes(edits.blocked) ? none : { ...none, notes: [namedLabelReason(label, edits.blocked)] }
  const preview = edits.length > 0 ? labelPreview(design, id, drop) : undefined
  return preview ? { edits, shown: [{ id, ...preview }], names: [labelName(label)], notes: [] } : none
}

/** The labels moved on their own (sortLabels' `alone`): each through a label drag's edit, dropped at its place plus `offset`. */
export function ownLabelMoves(design: Design, source: SourceCircuit, ids: readonly string[], offset: Point, locked: ReadonlySet<string>, said: readonly string[]): OwnLabelMoves {
  const moves = ids.map((id) => ownMove(design, source, id, offset, locked, said))
  return {
    edits: moves.flatMap((move) => move.edits),
    shown: moves.flatMap((move) => move.shown),
    names: moves.flatMap((move) => move.names),
    notes: moves.flatMap((move) => move.notes),
  }
}

/** The names of labels by id, for the history: "the GND flag". */
export function labelNames(design: Design, ids: readonly string[]): string[] {
  return ids.flatMap((id) => {
    const label = labelOf(design, id)
    return label ? [labelName(label)] : []
  })
}

/** How the history names labels among other things: the one label by its name, or how many. */
export const labelWords = (names: readonly string[]): string[] => (names.length > 1 ? [`${names.length} labels`] : [...names])
