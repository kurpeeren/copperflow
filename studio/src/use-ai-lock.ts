// The AI lock in the Studio: its state from the history (who wrote the newest change), the click that toggles it, the
// gate the choke points read, and the key guard that keeps editing keys from the canvases while it is closed.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { HistoryListing } from "./api"
import { afterChange, blocksKey, startLock, toggleLock, type AiLock } from "./ai-lock"
import { lockGate } from "./ai-lock-gate"
import { keyAction, keyInput } from "./pcb/canvas-keys"
import type { View } from "./pcb/positions"

export interface AiLockState {
  closed: boolean
  toggle(): void
}

/**
 * `loaded` turns true once the project's first history has arrived: the lock starts from its newest entry, then each
 * new newest entry is a change by the agent or by the person.
 */
export function useAiLock(history: readonly HistoryListing[], loaded: boolean, view: View, notify: (text: string) => void): AiLockState {
  const [lock, setLock] = useState<AiLock>()
  const newest = useRef<string | undefined>(undefined)
  useEffect(() => lockGate.listen(notify), [notify])
  useEffect(() => {
    if (!loaded) return
    const entry = history[0]
    if (entry?.id === newest.current && lock !== undefined) return
    newest.current = entry?.id
    setLock((current) => (current === undefined ? startLock(entry?.author) : entry ? afterChange(current, entry.author) : current))
  }, [history, loaded, lock])
  const closed = lock?.closed ?? false
  useLayoutEffect(() => lockGate.set(closed), [closed])
  useLockKeys(closed, view)
  const toggle = useCallback(() => setLock((current) => toggleLock(current ?? startLock(undefined))), [])
  return { closed, toggle }
}

/** While closed, an editing key stops here, before the canvases and the app see it; the first one says why. */
function useLockKeys(closed: boolean, view: View): void {
  useEffect(() => {
    if (!closed) return
    const onKey = (event: KeyboardEvent) => {
      const action = keyAction(keyInput(event), { view })?.action
      if (action === undefined || !blocksKey(action)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      lockGate.refuses()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [closed, view])
}
