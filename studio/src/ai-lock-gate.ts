// The AI lock as the choke points read it: api() for the requests, the canvases' presses and the key guard. The
// Studio sets it whenever the lock changes; the first blocked attempt after it closes says why.
import { AI_LOCK_MESSAGE } from "./ai-lock.js"

export function createLockGate(tell: (text: string) => void) {
  let closed = false
  let told = false
  let say = tell
  return {
    set(value: boolean): void {
      if (value && !closed) told = false
      closed = value
    },
    closed: (): boolean => closed,
    /** Where the message goes: the Studio's status message. */
    listen(next: (text: string) => void): void {
      say = next
    },
    /** True while closed; the first time since the lock closed, says so. */
    refuses(): boolean {
      if (!closed) return false
      if (!told) {
        told = true
        say(AI_LOCK_MESSAGE)
      }
      return true
    },
  }
}

export const lockGate = createLockGate(() => undefined)
