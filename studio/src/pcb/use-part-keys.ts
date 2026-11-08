// The keys both canvases share: F and K fit, R and Space rotate the selected part, Delete removes it, and
// H highlights the net under the pointer. What a key means is decided in canvas-keys.ts.
import { useEffect } from "react"
import type { CircuitData } from "../api"
import type { Actions } from "../App"
import type { PartCommand } from "../shell/command-owners"
import { useCommands } from "../shell/commands"
import { keyAction, keyInput } from "./canvas-keys"
import { isCanvasKey } from "./canvas-common"
import { nextRotation, VIEWS, type View } from "./positions"

export interface PartKeysInput {
  view: View
  selected: string | null
  /** R, Space and Delete wait while another tool, such as a wire being drawn, uses the keys. */
  paused: boolean
  circuit: CircuitData
  actions: Actions
  onSelect(name: string | null): void
  blockerFor(name: string): string | null
  fit(): void
  /** The net under the pointer, if any. */
  netUnderPointer(): string | undefined
  onHighlight(net: string | null): void
}

function rotatePart(input: PartKeysInput, name: string): void {
  const blocker = input.blockerFor(name)
  if (blocker) return input.actions.notify(blocker)
  const next = nextRotation(input.circuit, name, input.view)
  if (typeof next === "string") return input.actions.notify(next)
  const { rotation, where } = VIEWS[input.view]
  void input.actions.edit([{ kind: "setProps", part: name, props: { [rotation]: next } }], `rotate ${name}${where} to ${next}°`)
}

function removePart(input: PartKeysInput, name: string): void {
  const blocker = input.blockerFor(name)
  if (blocker) return input.actions.notify(blocker)
  if (!window.confirm(`Remove ${name} and its connections?`)) return
  void input.actions.edit([{ kind: "removePart", part: name }], `remove ${name}`).then((ok) => ok && input.onSelect(null))
}

/** Runs the canvas actions of a key press: fit, highlight, rotate. */
function runKey(input: PartKeysInput, action: string): void {
  if (action === "fit") return input.fit()
  if (action === "highlight") {
    const net = input.netUnderPointer()
    if (net !== undefined) input.onHighlight(net)
    return
  }
  if (action === "rotate" && input.selected && !input.paused) rotatePart(input, input.selected)
}

/** The same actions for the menu bar and the toolbar, which have no pointer over the canvas. */
function usePartCommands(input: PartKeysInput): void {
  const withSelection = (then: (name: string) => void) => () => {
    if (input.paused) return
    if (input.selected) then(input.selected)
    else input.actions.notify("Select a part first.")
  }
  const table: Record<PartCommand, () => void> = {
    fit: input.fit,
    rotate: withSelection((name) => rotatePart(input, name)),
    delete: withSelection((name) => removePart(input, name)),
    highlight: () => {
      const net = input.netUnderPointer()
      if (net !== undefined) input.onHighlight(net)
      else input.actions.notify("Point at a pin, a wire or a pad and press H to highlight its net.")
    },
  }
  useCommands(table)
}

export function usePartKeys(input: PartKeysInput): void {
  usePartCommands(input)
  const { view, selected, paused, circuit, actions, onSelect, blockerFor, fit, netUnderPointer, onHighlight } = input
  useEffect(() => {
    const keys: PartKeysInput = { view, selected, paused, circuit, actions, onSelect, blockerFor, fit, netUnderPointer, onHighlight }
    const onKey = (event: KeyboardEvent) => {
      const hit = keyAction(keyInput(event), { view, drawing: paused })
      if (hit) {
        if (hit.preventDefault) event.preventDefault()
        return runKey(keys, hit.action)
      }
      if (!isCanvasKey(event) || !selected || paused) return
      if (event.key === "Delete" || event.key === "Backspace") removePart(keys, selected)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [view, selected, paused, circuit, actions, onSelect, blockerFor, fit, netUnderPointer, onHighlight])
}
