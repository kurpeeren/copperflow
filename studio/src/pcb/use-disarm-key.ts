// Esc puts an armed canvas tool away, before anything else hears it: captured and stopped, so the same Escape does
// not also clear the selection or stop wiring; the next Escape does. Text fields keep their own Escape.
import { useEffect } from "react"
import { escapeDisarms, keyInput } from "./canvas-keys"

export function useDisarmKey(armed: boolean, disarm: () => void): void {
  useEffect(() => {
    if (!armed) return
    const onKey = (event: KeyboardEvent) => {
      if (!escapeDisarms(keyInput(event))) return
      event.stopPropagation()
      disarm()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [armed, disarm])
}
