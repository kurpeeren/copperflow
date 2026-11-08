// A tab list with a roving tab stop: Tab reaches the current tab only, the arrow keys, Home and End move between
// the tabs and show the one they reach, and Enter or Space shows the focused one. What a key means is tab-keys.ts.
import type { KeyboardEvent, MouseEvent } from "react"
import { blurButton, isPointerClick } from "./focus"
import { tabAfterKey } from "./tab-keys"

interface TabListInput<T extends string> {
  ids: readonly T[]
  /** The tab that holds the tab stop: the one shown, or the one the panel would show. */
  current: T
  /** Shows a tab: for the keys, and for clicks unless `onPointerClick` is given. */
  onSelect(id: T): void
  /** A pointer click; the side strips and the bottom strip collapse their panel when the open tab is clicked. */
  onPointerClick?(id: T): void
}

export function useTabList<T extends string>({ ids, current, onSelect, onPointerClick }: TabListInput<T>) {
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const next = tabAfterKey(ids, current, event.key)
    if (next === null) return
    event.preventDefault()
    // The arrows are the tab list's, not the canvas's.
    event.stopPropagation()
    onSelect(next)
    event.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus()
  }
  const tab = (id: T) => ({
    "data-tab": id,
    tabIndex: id === current ? 0 : -1,
    onClick: (event: MouseEvent<HTMLElement>) => {
      if (!isPointerClick(event)) return onSelect(id)
      blurButton(event)
      ;(onPointerClick ?? onSelect)(id)
    },
  })
  return { onKeyDown, tab }
}
