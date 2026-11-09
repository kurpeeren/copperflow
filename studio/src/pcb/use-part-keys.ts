// The keys both canvases share: F and K fit, R and Space turn the selection about its centre, the arrows move it, Delete removes them, H
// highlights the net under the pointer (the menu's Highlight net, the selected parts' nets), and Shift+F10 or the menu
// key opens the context menu. What a key means is decided in canvas-keys.ts; what Rotate and Delete do to several
// parts, in group-edits.ts. Ctrl+A is the app's.
import { useEffect } from "react"
import type { CircuitData } from "../api"
import type { Actions } from "../App"
import type { Selection, SelectionChange } from "../selection"
import type { PartCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import { keyAction, keyInput, type KeyResult } from "./canvas-keys"
import { isCanvasKey } from "./canvas-common"
import { removeEach, removeQuestion, sendGroupEdit, type Layout } from "./group-edits"
import { claimsKey, type BuildStatus } from "./key-burst"
import { useKeyEdits, type KeyEdits } from "./use-key-edits"
import { menuHighlight, type Highlight } from "./highlight"
import type { Point } from "./geometry"
import type { View } from "./positions"
import type { ContextTarget } from "./press"

export interface PartKeysInput {
  view: View
  selection: Selection
  /** R, Space and Delete wait while another tool, such as a wire being drawn, uses the keys. */
  paused: boolean
  circuit: CircuitData
  actions: Actions
  onSelect(change: SelectionChange): void
  blockerFor(name: string): string | null
  /** Where the parts sit and the open view's Grid step, for the arrow keys and the turn about the selection's centre. */
  layout: Layout
  /** The shown build's id and the build status; a Rotate waits for a build that succeeds after the last move. */
  builtMark: number | undefined
  buildStatus: BuildStatus
  /** A dragged group's move waits for its build, so a Rotate waits too. */
  moveWaiting: boolean
  fit(): void
  /** The net under the pointer, if any. */
  netUnderPointer(): string | undefined
  /** The nets a part's pins are on. */
  netsOf(part: string): Highlight
  onHighlight(nets: Highlight): void
  /** Where Shift+F10 or the menu key opens the context menu (key-menu.ts), and the way to open it. */
  menuPlace(): { target: ContextTarget; at: Point }
  onContextMenu(target: ContextTarget, at: Point): void
}

/** Removes every selected part that may go, in one change, after asking; the rest are named and stay selected. */
function removeSelection(input: PartKeysInput): void {
  const plan = removeEach(input.selection.names, input.blockerFor)
  if (plan.edits.length > 0 && !window.confirm(removeQuestion(plan.parts))) return
  void sendGroupEdit(plan, input.actions).then((ok) => ok && input.onSelect((current) => current.without(plan.parts)))
}

/** Runs the canvas actions of a key press: fit, highlight, rotate, nudge. */
function runKey(input: PartKeysInput, hit: KeyResult, edits: KeyEdits, repeat: boolean): void {
  const { action } = hit
  if (action.startsWith("nudge")) return input.paused ? undefined : edits.nudge(input, hit)
  if (action === "fit") return input.fit()
  if (action === "contextMenu") {
    if (input.paused) return
    const { target, at } = input.menuPlace()
    return input.onContextMenu(target, at)
  }
  if (action === "highlight") {
    const net = input.netUnderPointer()
    if (net !== undefined) input.onHighlight([net])
    return
  }
  if (action === "rotate" && input.selection.size > 0 && !input.paused) edits.rotate(input, repeat)
}

/** The same actions for the menu bar, the toolbar and Properties, which have no pointer over the canvas. */
function usePartCommands(input: PartKeysInput, edits: KeyEdits): void {
  const withSelection = (then: (input: PartKeysInput) => void) => () => {
    if (input.paused) return
    if (input.selection.size > 0) then(input)
    else input.actions.notify("Select a part first.")
  }
  const table: Record<PartCommand, () => void> = {
    fit: input.fit,
    rotate: withSelection((chosen) => edits.rotate(chosen, false)),
    delete: withSelection(removeSelection),
    highlight: () => {
      const result = menuHighlight(input.selection.names, input.netsOf)
      if ("nets" in result) input.onHighlight(result.nets)
      else input.actions.notify(result.message)
    },
  }
  useCommands(table)
}

/** Wires the part keys and commands; returns whether a Rotate press is held until the next build. */
export function usePartKeys(input: PartKeysInput): { rotateHeld: boolean } {
  const { edits, held } = useKeyEdits(input)
  usePartCommands(input, edits)
  const { view, selection, paused, circuit, actions, onSelect, blockerFor, layout, builtMark, buildStatus, moveWaiting, fit, netUnderPointer, netsOf, onHighlight, menuPlace, onContextMenu } = input
  useEffect(() => {
    const keys: PartKeysInput = { view, selection, paused, circuit, actions, onSelect, blockerFor, layout, builtMark, buildStatus, moveWaiting, fit, netUnderPointer, netsOf, onHighlight, menuPlace, onContextMenu }
    const onKey = (event: KeyboardEvent) => {
      const hit = keyAction(keyInput(event), { view, drawing: paused })
      if (hit) {
        if (claimsKey(hit.action, selection.size, paused, hit.preventDefault)) event.preventDefault()
        return runKey(keys, hit, edits, event.repeat)
      }
      if (!isCanvasKey(event) || selection.size === 0 || paused) return
      if (event.key === "Delete" || event.key === "Backspace") removeSelection(keys)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [edits, view, selection, paused, circuit, actions, onSelect, blockerFor, layout, builtMark, buildStatus, moveWaiting, fit, netUnderPointer, netsOf, onHighlight, menuPlace, onContextMenu])
  return { rotateHeld: held }
}
