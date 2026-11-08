// Which tool the open canvas has armed, shared with the toolbar so its button shows pressed. The canvas publishes;
// `stop` puts the tool away, for a second click on the pressed button.
import { useSyncExternalStore } from "react"
import type { CommandId } from "./menus.js"

export interface ToolState {
  active: CommandId | null
  stop: (() => void) | null
}

const NONE: ToolState = { active: null, stop: null }
let state: ToolState = NONE
const listeners = new Set<() => void>()

export function setToolState(next: ToolState): void {
  if (next.active === state.active && next.stop === state.stop) return
  state = next
  for (const listener of listeners) listener()
}

export function getToolState(): ToolState {
  return state
}

export function clearToolState(): void {
  setToolState(NONE)
}

function subscribeToolState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useToolState(): ToolState {
  return useSyncExternalStore(subscribeToolState, getToolState)
}

/** What a click on a tool button does: put the armed tool away, or send the command. */
export function clickAction(command: CommandId, current: ToolState): "stop" | "run" {
  return current.active === command && current.stop ? "stop" : "run"
}
