// The keys both canvases share: F and K fit, R and Space turn the selection about its centre, the arrows move it, Delete or Backspace removes them, H
// highlights the net under the pointer (the menu's Highlight net, the selected parts' nets), and Shift+F10 or the menu
// key opens the context menu. What a key means is decided in canvas-keys.ts; what Rotate and Delete do to several
// parts, in group-edits.ts. Ctrl+A is the app's. A wire selected on the schematic is deleted and highlighted through
// the schematic's own `wire` (use-sheet-wires.ts), on the same keys and commands.
import { useEffect } from "react"
import type { CircuitData } from "../api"
import type { Actions } from "../App"
import type { Selection, SelectionChange } from "../selection"
import type { PartCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import { ALIGN_COMMANDS, isAlignCommand, type AlignCommand } from "./align-rules"
import { keyAction, keyInput, type KeyResult } from "./canvas-keys"
import { removeEach, removeQuestion, sendGroupEdit, type Layout } from "./group-edits"
import { claimsKey, type BuildStatus } from "./key-burst"
import { useKeyEdits, type KeyEdits } from "./use-key-edits"
import { menuHighlight, type Highlight } from "./highlight"
import type { Point } from "./geometry"
import type { View } from "./positions"
import type { ContextTarget } from "./press"
import type { WireKeys } from "./use-sheet-wires"

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
  /**
   * The shown build's start mark (the server's mark when that build started) and the build status; a Rotate waits
   * for a build that started after the last move was written, and succeeded.
   */
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
  /** The schematic's selected wire: its Delete and its net. The PCB has none. */
  wire?: WireKeys
}

/** Whether anything is selected that Delete can act on: parts, or a wire. */
const hasSelection = (selection: Selection): boolean => selection.size > 0 || selection.wire !== undefined

/**
 * Removes the selected wire's trace, or every selected part that may go, in one change, after asking for parts; the
 * parts that may not go are named and stay selected.
 */
function removeSelection(input: PartKeysInput): void {
  if (input.selection.wire !== undefined) return input.wire?.remove(input.selection.wire)
  const plan = removeEach(input.selection.names, input.blockerFor)
  if (plan.edits.length > 0 && !window.confirm(removeQuestion(plan.parts))) return
  void sendGroupEdit(plan, input.actions).then((ok) => ok && input.onSelect((current) => current.without(plan.parts)))
}

/** Runs the canvas actions of a key press: fit, highlight, rotate, nudge, align, delete. */
function runKey(input: PartKeysInput, hit: KeyResult, edits: KeyEdits, repeat: boolean): void {
  const { action } = hit
  if (isAlignCommand(action)) return input.paused || repeat ? undefined : edits.align(input, action)
  if (action.startsWith("nudge")) return input.paused ? undefined : edits.nudge(input, hit)
  if (action === "fit") return input.fit()
  if (action === "delete") return hasSelection(input.selection) && !input.paused ? removeSelection(input) : undefined
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

/** Design → Highlight net with no pointer over the canvas: the selected wire's net, else every net of the selected parts. */
function highlightSelection(input: PartKeysInput): void {
  const { wire } = input.selection
  const net = wire === undefined ? undefined : input.wire?.net(wire)
  if (net !== undefined) return input.onHighlight([net])
  const result = menuHighlight(input.selection.names, input.netsOf)
  if ("nets" in result) input.onHighlight(result.nets)
  else input.actions.notify(result.message)
}

/** The same actions for the menu bar, the toolbar and Properties, which have no pointer over the canvas. */
function usePartCommands(input: PartKeysInput, edits: KeyEdits): void {
  const withSelection = (then: (input: PartKeysInput) => void) => () => {
    if (input.paused) return
    if (input.selection.size > 0) then(input)
    else input.actions.notify("Select a part first.")
  }
  const aligns = Object.fromEntries(ALIGN_COMMANDS.map((command) => [command, () => (input.paused ? undefined : edits.align(input, command))])) as Record<AlignCommand, () => void>
  const table: Record<PartCommand, () => void> = {
    ...aligns,
    fit: input.fit,
    rotate: withSelection((chosen) => edits.rotate(chosen, false)),
    rotateRight: withSelection((chosen) => edits.rotateRight(chosen)),
    delete: () => {
      if (input.paused) return
      if (hasSelection(input.selection)) removeSelection(input)
      else input.actions.notify("Select a part first.")
    },
    highlight: () => highlightSelection(input),
  }
  useCommands(table)
}

/** Wires the part keys and commands; returns whether a Rotate press is held until the next build. */
export function usePartKeys(input: PartKeysInput): { rotateHeld: boolean } {
  const { edits, held } = useKeyEdits(input)
  usePartCommands(input, edits)
  const { view, selection, paused, circuit, actions, onSelect, blockerFor, layout, builtMark, buildStatus, moveWaiting, fit, netUnderPointer, netsOf, onHighlight, menuPlace, onContextMenu, wire } = input
  useEffect(() => {
    const keys: PartKeysInput = { view, selection, paused, circuit, actions, onSelect, blockerFor, layout, builtMark, buildStatus, moveWaiting, fit, netUnderPointer, netsOf, onHighlight, menuPlace, onContextMenu, wire }
    const onKey = (event: KeyboardEvent) => {
      const hit = keyAction(keyInput(event), { view, drawing: paused })
      if (!hit) return
      if (claimsKey(hit.action, selection.size, paused, hit.preventDefault)) event.preventDefault()
      runKey(keys, hit, edits, event.repeat)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [edits, view, selection, paused, circuit, actions, onSelect, blockerFor, layout, builtMark, buildStatus, moveWaiting, fit, netUnderPointer, netsOf, onHighlight, menuPlace, onContextMenu, wire])
  return { rotateHeld: held }
}
