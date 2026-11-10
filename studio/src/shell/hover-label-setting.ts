// View → Hover labels: whether the canvases show the label of what rests under the pointer. On until switched off, and
// remembered per browser as theme-state.ts remembers the theme. Plain TypeScript, so the tests run it without a DOM.
import type { ThemeStore } from "./theme-state.js"

/** The browser storage key the choice is kept under. */
export const HOVER_LABELS_KEY = "copperflow.hoverLabels"

const OFF = "off"
const ON = "on"

/** The remembered choice; on when nothing is kept or the storage is blocked (`store` may itself throw). */
export function loadHoverLabels(store: () => ThemeStore | undefined): boolean {
  try {
    return store()?.getItem(HOVER_LABELS_KEY) !== OFF
  } catch {
    return true
  }
}

/** Remembers the choice; false when the storage is missing or blocked, and the switch still holds for this visit. */
export function saveHoverLabels(store: () => ThemeStore | undefined, on: boolean): boolean {
  try {
    const storage = store()
    if (!storage) return false
    storage.setItem(HOVER_LABELS_KEY, on ? ON : OFF)
    return true
  } catch {
    return false
  }
}
