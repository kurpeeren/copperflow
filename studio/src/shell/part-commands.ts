// The app's commands on the selected parts that write through the core as one history entry each: Layout → Flip,
// Design → Placement transfer and Annotate designators, Edit → Copy and Paste, and Edit → Find similar objects (which
// only selects). What each writes is decided in board-side.ts, annotate.ts, clipboard.ts and find-similar.ts; this
// file reads the open design and selection for them.
import type { CircuitData, Design } from "../api"
import type { Actions } from "../App"
import { Selection, type SelectionChange } from "../selection"
import { flipPlan, transferPlan, type PlanResult } from "./board-side"
import { findSimilar } from "./find-similar"
import { annotatePlan } from "./annotate"
import { copyParts, pasteEdits, type Clipboard } from "./clipboard"

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

/** Design → Annotate designators: every part numbered again by where its symbol sits, as one history entry. */
export function annotateDesignators({ design, circuit, actions }: PartCommandInput): void {
  if (!design || !circuit) return
  const locked = lockedParts(circuit)
  const pages = design.schematic.pages ?? []
  const instances = new Set(design.circuit.components.filter((component) => component.kind === "sheet").map((component) => component.id))
  const parts = circuit.model.parts
    .filter((part) => !instances.has(part.name))
    .map((part) => {
      const symbol = design.schematic.symbols.find((placed) => placed.component === part.name)
      const page = Math.max(0, pages.findIndex((entry) => entry.parts.includes(part.name)))
      return { name: part.name, renamable: part.editable && !locked.has(part.name), ...(symbol ? { at: { page, x: symbol.x, y: symbol.y } } : {}) }
    })
  // The parts sub-sheet instances bring in (R101 from a sheet at base 100) keep their designators, and their numbers are taken.
  const own = new Set(circuit.model.parts.map((part) => part.name))
  const inside = design.circuit.components.filter((component) => !own.has(component.id) && component.kind !== "sheet").map((component) => ({ name: component.id, renamable: false }))
  const plan = annotatePlan([...parts, ...inside])
  if ("message" in plan) return actions.notify(plan.message)
  void actions.renameParts(plan.edit.mapping, plan.summary).then((outcome) => outcome.ok && actions.notify(`Annotated ${plan.edit.mapping.length} designators`))
}

/** What Edit → Copy took last; one per Studio tab, as EasyEDA keeps its own clipboard for parts. */
let copied: Clipboard | undefined

/** Edit → Copy (Ctrl+C): the selected parts and the traces among them. */
export function copySelection({ circuit, selection, actions }: PartCommandInput): void {
  if (!circuit) return
  const clip = copyParts(circuit.model, selection.names)
  if ("message" in clip) return actions.notify(clip.message)
  copied = clip
  const what = clip.parts.length === 1 ? (clip.parts[0]?.name ?? "") : `${clip.parts.length} parts`
  const traces = clip.traces.length > 0 ? ` and ${clip.traces.length} ${clip.traces.length === 1 ? "trace" : "traces"}` : ""
  const left = clip.left.length > 0 ? `; left out ${clip.left.join(", ")} (written as expressions)` : ""
  actions.notify(`Copied ${what}${traces}${left}`)
}

/** Edit → Paste (Ctrl+V): what Copy took, as new parts with the next free designators, one history entry; selected once written. */
export function pasteCopied({ circuit, select, actions }: PartCommandInput, page: string | undefined): void {
  if (!circuit) return
  if (!copied) return actions.notify("Copy some parts first (Ctrl+C).")
  const { edits, summary, names } = pasteEdits(copied, circuit.model, page)
  void actions.edit(edits, summary).then((ok) => {
    if (!ok) return
    select(() => Selection.none.all(names))
    actions.notify(`Pasted ${names.join(", ")}`)
  })
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
