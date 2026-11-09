// The keys both canvases share: F and K fit, R and Space rotate the selected parts, Delete removes them, and H
// highlights the net under the pointer (the menu's Highlight net, the selected parts' nets).
// What a key means is decided in canvas-keys.ts; what Rotate and Delete do to several parts, in group-edits.ts.
import { useEffect } from "react"
import type { CircuitData } from "../api"
import type { Actions } from "../App"
import type { Selection, SelectionChange } from "../selection"
import type { PartCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import { keyAction, keyInput } from "./canvas-keys"
import { isCanvasKey } from "./canvas-common"
import { removeEach, removeQuestion, rotateEach, skippedNote } from "./group-edits"
import { menuHighlight, type Highlight } from "./highlight"
import type { View } from "./positions"

export interface PartKeysInput {
  view: View
  selection: Selection
  /** R, Space and Delete wait while another tool, such as a wire being drawn, uses the keys. */
  paused: boolean
  circuit: CircuitData
  actions: Actions
  onSelect(change: SelectionChange): void
  blockerFor(name: string): string | null
  fit(): void
  /** The net under the pointer, if any. */
  netUnderPointer(): string | undefined
  /** The nets a part's pins are on. */
  netsOf(part: string): Highlight
  onHighlight(nets: Highlight): void
}

/** A quarter turn for every selected part that may turn, in one change; the rest are named. */
function rotateSelection(input: PartKeysInput): void {
  const plan = rotateEach(input.circuit, input.selection.names, input.view, input.blockerFor)
  const note = skippedNote(plan)
  if (note) input.actions.notify(note)
  if (plan.edits.length > 0) void input.actions.edit(plan.edits, plan.summary)
}

/** Removes every selected part that may go, in one change, after asking; the rest are named and stay selected. */
function removeSelection(input: PartKeysInput): void {
  const plan = removeEach(input.selection.names, input.blockerFor)
  const note = skippedNote(plan)
  if (plan.edits.length === 0) return note ? input.actions.notify(note) : undefined
  if (!window.confirm(removeQuestion(plan.parts))) return
  if (note) input.actions.notify(note)
  void input.actions.edit(plan.edits, plan.summary).then((ok) => ok && input.onSelect((current) => current.without(plan.parts)))
}

/** Runs the canvas actions of a key press: fit, highlight, rotate. */
function runKey(input: PartKeysInput, action: string): void {
  if (action === "fit") return input.fit()
  if (action === "highlight") {
    const net = input.netUnderPointer()
    if (net !== undefined) input.onHighlight([net])
    return
  }
  if (action === "rotate" && input.selection.size > 0 && !input.paused) rotateSelection(input)
}

/** The same actions for the menu bar, the toolbar and Properties, which have no pointer over the canvas. */
function usePartCommands(input: PartKeysInput): void {
  const withSelection = (then: (input: PartKeysInput) => void) => () => {
    if (input.paused) return
    if (input.selection.size > 0) then(input)
    else input.actions.notify("Select a part first.")
  }
  const table: Record<PartCommand, () => void> = {
    fit: input.fit,
    rotate: withSelection(rotateSelection),
    delete: withSelection(removeSelection),
    highlight: () => {
      const result = menuHighlight(input.selection.names, input.netsOf)
      if ("nets" in result) input.onHighlight(result.nets)
      else input.actions.notify(result.message)
    },
  }
  useCommands(table)
}

export function usePartKeys(input: PartKeysInput): void {
  usePartCommands(input)
  const { view, selection, paused, circuit, actions, onSelect, blockerFor, fit, netUnderPointer, netsOf, onHighlight } = input
  useEffect(() => {
    const keys: PartKeysInput = { view, selection, paused, circuit, actions, onSelect, blockerFor, fit, netUnderPointer, netsOf, onHighlight }
    const onKey = (event: KeyboardEvent) => {
      const hit = keyAction(keyInput(event), { view, drawing: paused })
      if (hit) {
        if (hit.preventDefault) event.preventDefault()
        return runKey(keys, hit.action)
      }
      if (!isCanvasKey(event) || selection.size === 0 || paused) return
      if (event.key === "Delete" || event.key === "Backspace") removeSelection(keys)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [view, selection, paused, circuit, actions, onSelect, blockerFor, fit, netUnderPointer, netsOf, onHighlight])
}
