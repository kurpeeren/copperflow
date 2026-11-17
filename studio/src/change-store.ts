// The change shown over the board, if any: one store the Log's Show buttons, the change bar, the canvas and the command
// gate all read. A change is fetched (and its two designs built) only when the person asks to see it.
import { useSyncExternalStore } from "react"
import { api } from "./api.js"
import type { ChangeShown } from "../../src/studio/change-route.js"
import { changePath, type ChangeMode, type ChangeRequest, type ChangeViewState } from "./change-view.js"

let state: ChangeViewState | undefined
let asked = 0
const listeners = new Set<() => void>()

function set(next: ChangeViewState | undefined): void {
  state = next
  for (const listener of listeners) listener()
}

export const changeStore = {
  /** Shows a change; a later request wins over one still loading. */
  async show(request: ChangeRequest): Promise<void> {
    const mine = ++asked
    set({ request, mode: "both", status: "loading" })
    try {
      const data = await api<ChangeShown>(changePath(request))
      if (mine === asked && state) set({ ...state, status: "ready", data })
    } catch (error) {
      if (mine === asked && state) set({ ...state, status: "failed", error: (error as Error).message })
    }
  },
  setMode(mode: ChangeMode): void {
    if (state) set({ ...state, mode })
  },
  close(): void {
    asked += 1
    set(undefined)
  },
  shown: (): boolean => state !== undefined,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  get: (): ChangeViewState | undefined => state,
}

/** The change shown now, if any; re-renders when it changes. */
export function useChangeView(): ChangeViewState | undefined {
  return useSyncExternalStore(changeStore.subscribe, changeStore.get, changeStore.get)
}
