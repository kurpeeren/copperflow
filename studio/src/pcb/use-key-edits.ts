// The edits the keys write, kept apart from the key map: one key session per canvas (key-session.ts), and the effect
// that lets a held Rotate go once the canvas has drawn the build, circuit or edit it was waiting for.
import { useEffect, useState } from "react"
import { keySession, type EditInput, type KeySession } from "./key-session"

export type { EditInput } from "./key-session"
export type KeyEdits = Pick<KeySession, "nudge" | "rotate">

/** `input` is what the canvas has now; a held Rotate is computed from it once the design has caught up. */
export function useKeyEdits(input: EditInput): KeyEdits {
  const [resolvedCount, setResolvedCount] = useState(0)
  const [session] = useState(() => keySession({ now: Date.now, resolved: () => setResolvedCount((count) => count + 1) }))
  const { builtFrom, moveWaiting, circuit } = input
  // After the render that drew the new build, circuit or resolved edit, so a held turn reads them as they are now.
  useEffect(() => session.settle(input), [session, builtFrom, moveWaiting, circuit, resolvedCount])
  return session
}
