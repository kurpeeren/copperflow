// What a click, a selection box or Select all may pick. Every pick asks canPick, so a rule about what may be selected
// (the Filter tab of round 4) plugs in at this one place: the target under the pointer (gestures.ts targetAt), the
// parts a box takes (box-select.ts boxSelection) and Select all. Plain TypeScript with .js imports, so the tests can run it.
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { Selection, SelectionChange } from "../selection.js"
import { anyLayerShown, type PickLayers } from "./layers.js"
import type { ArmedTool } from "./press.js"

/** Something a pick can take: a part, by name, or a net label on the schematic. */
export type Pickable = { kind: "part"; name: string } | { kind: "label"; label: NetLabel }

/** What a pick is made with. */
export interface PickContext {
  /** The selection the pick changes. */
  selection: Selection
  /** The armed canvas tool; null for Select all, which no canvas tool sees. */
  armed: ArmedTool
  /** On the PCB: a part whose drawn layers are all hidden cannot be picked. The schematic has no layers. */
  layers?: PickLayers
}

/**
 * Whether `candidate` may be picked. With the Note box tool armed a press draws the note box, so nothing is picked
 * under it (and a double click opens nothing); a PCB part needs one of its layers shown; otherwise every part and net
 * label may be.
 */
export function canPick(candidate: Pickable, context: PickContext): boolean {
  if (context.armed === "note") return false
  const { layers } = context
  const drawn = candidate.kind === "part" ? layers?.of(candidate.name) : undefined
  return !layers || !drawn || anyLayerShown(drawn, layers.visible)
}

/** The candidates that may be picked, in their order: what is under the pointer (smallest first), in a box, or in the circuit. */
export function picks<T extends Pickable>(candidates: readonly T[], context: PickContext): T[] {
  return candidates.filter((candidate) => canPick(candidate, context))
}

/** The parts among `names` that may be picked, in their order. */
export function pickNames(names: readonly string[], context: PickContext): string[] {
  return picks(names.map((name) => ({ kind: "part" as const, name })), context).map((part) => part.name)
}

/** Select all: every part of the circuit that may be picked, each once; on the PCB, not those on hidden layers. */
export function selectAll(names: readonly string[], layers?: PickLayers): SelectionChange {
  return (current) => current.all(pickNames(names, { selection: current, armed: null, layers }))
}
