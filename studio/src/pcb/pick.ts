// What a click, a selection box, Select all or the hover may pick. Every pick asks canPick, so the rules about what may
// be selected (the note tool, the Filter tab, the PCB's hidden layers) live in this one place: the target under the
// pointer and the hover (gestures.ts targetAt), the parts a box takes (box-select.ts boxSelection), the pad under the
// pointer (pcb-draw.ts padAt) and Select all. Plain TypeScript with .js imports, so the tests can run it.
import type { NetLabel } from "../../../src/engine/schematic.js"
import type { Selection, SelectionChange } from "../selection.js"
import { anyLayerShown, type PickLayers } from "./layers.js"
import { kindPickable, type PickFilter, type PickKind } from "./pick-filter.js"
import type { ArmedTool } from "./press.js"

/**
 * Something a pick can take: a part, by name, a net label, a wire or a drawing (by its id) on the schematic, a track or
 * via (by its layout id) on the PCB, or a part's name, value or designator (by its text id, "R1:schNameAt").
 */
export type Pickable =
  | { kind: "part"; name: string }
  | { kind: "label"; label: NetLabel }
  | { kind: "wire"; id: string }
  | { kind: "drawing"; id: string }
  | { kind: "track"; id: string }
  | { kind: "via"; id: string }
  | { kind: "text"; id: string }

const KINDS: Record<Pickable["kind"], PickKind> = { part: "parts", label: "labels", wire: "wires", drawing: "drawings", track: "tracks", via: "vias", text: "texts" }

/** What a pick is made with. */
export interface PickContext {
  /** The selection the pick changes. */
  selection: Selection
  /** The armed canvas tool; null for Select all, which no canvas tool sees. */
  armed: ArmedTool
  /** On the PCB: a part whose drawn layers are all hidden cannot be picked. The schematic has no layers. */
  layers?: PickLayers
  /** The Filter tab: a kind switched off cannot be picked. */
  filter?: PickFilter
}

/**
 * Whether `candidate` may be picked. With the Note box tool armed a press draws the note box, so nothing is picked
 * under it (and a double click opens nothing); a kind the Filter tab switched off cannot be picked; a PCB part needs one
 * of its layers shown; otherwise every part, net label and wire may be.
 */
export function canPick(candidate: Pickable, context: PickContext): boolean {
  if (!kindAllowed(KINDS[candidate.kind], context)) return false
  const { layers } = context
  const drawn = candidate.kind === "part" ? layers?.of(candidate.name) : undefined
  return !layers || !drawn || anyLayerShown(drawn, layers.visible)
}

/** Whether things of this kind may be picked at all: not under the Note box or Fit area tool, nor while the Filter tab has the kind off. */
function kindAllowed(kind: PickKind, context: PickContext): boolean {
  if (context.armed === "note" || context.armed === "zoom") return false
  return kindPickable(context.filter, kind)
}

/** The candidates that may be picked, in their order: what is under the pointer (smallest first), in a box, or in the circuit. */
export function picks<T extends Pickable>(candidates: readonly T[], context: PickContext): T[] {
  return candidates.filter((candidate) => canPick(candidate, context))
}

/** The parts among `names` that may be picked, in their order. */
export function pickNames(names: readonly string[], context: PickContext): string[] {
  return picks(names.map((name) => ({ kind: "part" as const, name })), context).map((part) => part.name)
}

/** The wires among `ids` that may be picked, in their order. */
export function pickWires(ids: readonly string[], context: PickContext): string[] {
  return picks(ids.map((id) => ({ kind: "wire" as const, id })), context).map((wire) => wire.id)
}

/** The net labels and flags among `ids` that may be picked, in their order; whether one may does not depend on which it is. */
export function pickLabels(ids: readonly string[], context: PickContext): string[] {
  return kindAllowed("labels", context) ? [...ids] : []
}

/** The drawings among `ids` that may be picked, in their order; whether one may does not depend on which it is. */
export function pickDrawings(ids: readonly string[], context: PickContext): string[] {
  return kindAllowed("drawings", context) ? [...ids] : []
}

/** The tracks and vias among `items` that may be picked (the Filter tab's Tracks and Vias rows), as ids in their order. */
export function pickCopper(items: readonly { kind: "track" | "via"; id: string }[], context: PickContext): string[] {
  return picks(items.map(({ kind, id }) => ({ kind, id })), context).map((item) => item.id)
}

/**
 * Select all: every part of the circuit that may be picked, each once; on the PCB, not those on hidden layers, none
 * while Parts is off. On the schematic `wires`, `labels` and `drawings` are the sheet's wires, its net labels and flags
 * and its drawings, and every one that may be picked joins them.
 */
export function selectAll(
  names: readonly string[],
  layers?: PickLayers,
  filter?: PickFilter,
  wires: readonly string[] = [],
  labels: readonly string[] = [],
  drawings: readonly string[] = [],
  copper: readonly { kind: "track" | "via"; id: string }[] = [],
): SelectionChange {
  return (current) => {
    const context = { selection: current, armed: null, layers, filter }
    return current.all(pickNames(names, context), pickWires(wires, context), pickLabels(labels, context), pickDrawings(drawings, context), pickCopper(copper, context))
  }
}
