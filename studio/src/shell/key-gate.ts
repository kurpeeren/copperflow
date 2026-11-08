// While a dialog or an open menu holds the keys, no key press reaches the canvases, the workspace or the app. The
// gate listens first, in the capture phase on window (main.tsx installs it before anything renders), hands the press
// to the newest holder and stops it there, before the window's other listeners, capturing ones included. The press's
// default action still happens, so Enter and Space still press the focused button and Tab still moves the focus
// unless the holder cancels it.
import { useEffect, useLayoutEffect, useRef } from "react"

interface Stoppable {
  stopImmediatePropagation(): void
}

export type KeyHolder<E extends Stoppable = KeyboardEvent> = (event: E) => void

export function createKeyGate<E extends Stoppable>() {
  let holders: readonly KeyHolder<E>[] = []
  return {
    /** The newest holder sees every key press until it lets go; returns the way to let go. */
    hold(holder: KeyHolder<E>): () => void {
      holders = [...holders, holder]
      return () => {
        holders = holders.filter((h) => h !== holder)
      }
    },
    held(): boolean {
      return holders.length > 0
    },
    /** Gives the press to the newest holder and stops it; false when nobody holds the keys. */
    dispatch(event: E): boolean {
      const holder = holders.at(-1)
      if (!holder) return false
      holder(event)
      event.stopImmediatePropagation()
      return true
    },
  }
}

export const keyGate = createKeyGate<KeyboardEvent>()

export function installKeyGate(target: Window): () => void {
  const onKey = (event: KeyboardEvent) => void keyGate.dispatch(event)
  target.addEventListener("keydown", onKey, true)
  return () => target.removeEventListener("keydown", onKey, true)
}

/** While `active`, the component holds the keys; `holder` may change on every render. */
export function useKeyHold(active: boolean, holder: KeyHolder): void {
  const latest = useRef(holder)
  useLayoutEffect(() => {
    latest.current = holder
  })
  useEffect(() => (active ? keyGate.hold((event) => latest.current(event)) : undefined), [active])
}
