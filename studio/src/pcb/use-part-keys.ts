// The part keys both canvases share: F fits, R rotates the selected part, Delete removes it.
import { useEffect } from "react"
import type { CircuitData } from "../api"
import type { Actions } from "../App"
import { isCanvasKey } from "./canvas-common"
import { nextRotation, VIEWS, type View } from "./positions"

export interface PartKeysInput {
  view: View
  selected: string | null
  /** R and Delete wait while another tool, such as a wire being drawn, uses the keys. */
  paused: boolean
  circuit: CircuitData
  actions: Actions
  onSelect(name: string | null): void
  blockerFor(name: string): string | null
  fit(): void
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

export function usePartKeys(input: PartKeysInput): void {
  const { view, selected, paused, circuit, actions, onSelect, blockerFor, fit } = input
  useEffect(() => {
    const keys: PartKeysInput = { view, selected, paused, circuit, actions, onSelect, blockerFor, fit }
    const onKey = (event: KeyboardEvent) => {
      if (!isCanvasKey(event)) return
      if (event.key === "f" || event.key === "F") return fit()
      if (!selected || paused) return
      if (event.key === "r" || event.key === "R") rotatePart(keys, selected)
      if (event.key === "Delete" || event.key === "Backspace") removePart(keys, selected)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [view, selected, paused, circuit, actions, onSelect, blockerFor, fit])
}
