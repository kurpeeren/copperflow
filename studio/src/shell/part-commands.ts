// The app's commands on the selected parts that write through the core as one history entry each: Layout → Flip,
// Design → Placement transfer and Edit → Find similar objects (which only selects). What each writes is decided in
// board-side.ts and find-similar.ts; this file reads the open design and selection for them.
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import { Selection, type SelectionChange } from "../selection"
import { flipPlan, transferPlan, type PlanResult } from "./board-side"
import { findSimilar } from "./find-similar"

export interface PartCommandInput {
  design: Design | undefined
  circuit: CircuitData | undefined
  selection: Selection
  select(change: SelectionChange): void
  actions: Actions
}

/** The parts locked in the open circuit. */
export const lockedParts = (circuit: CircuitData | undefined): ReadonlySet<string> => new Set(circuit?.annotations.locks.filter((lock) => !lock.drawing).map((lock) => lock.part))

function write(actions: Actions, plan: PlanResult): void {
  if ("message" in plan) return actions.notify(plan.message)
  void actions.edit(plan.edits, plan.summary)
}

/** Layout → Flip (X): the selected parts to the other side of the board. */
export function flipSelection({ design, circuit, selection, actions }: PartCommandInput): void {
  if (!design || !circuit) return
  write(actions, flipPlan(selection.names, design.pcb.parts, circuit.model.parts, lockedParts(circuit)))
}

/** Design → Placement transfer (Ctrl+Shift+X): the selected parts, or every part, placed as on the schematic. */
export function transferPlacement({ design, circuit, selection, actions }: PartCommandInput): void {
  if (!design || !circuit) return
  const names = selection.names.length > 0 ? selection.names : design.pcb.parts.map((part) => part.component)
  const sheet = design.schematic.symbols.map((symbol) => ({ component: symbol.component, x: symbol.x, y: symbol.y }))
  write(actions, transferPlan(names, sheet, design.pcb.parts, circuit.model.parts, lockedParts(circuit)))
}

/** Edit → Find similar objects (Ctrl+Shift+F): selects the parts, or drawings, like the selected one. */
export function selectSimilar({ design, selection, select, actions }: PartCommandInput): void {
  if (!design) return
  const parts = design.circuit.components.map((component) => ({ id: component.id, kind: component.kind, ...(component.footprint ? { footprint: component.footprint } : {}), ...(component.value ? { value: component.value } : {}) }))
  const found = findSimilar({ parts: selection.names, drawings: selection.drawings }, parts, design.schematic.drawings)
  if ("message" in found) return actions.notify(found.message)
  select(() => Selection.none.all(found.parts).addDrawings(found.drawings))
  actions.notify(found.note)
}
