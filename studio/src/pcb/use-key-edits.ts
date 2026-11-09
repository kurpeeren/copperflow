// The edits the keys write, kept apart from the key map: one key session per canvas (key-session.ts), and the effect
// that lets a held Rotate go once the canvas has drawn the build, circuit or edit it was waiting for.
import { useEffect, useState } from "react"
import { keySession, type EditInput, type KeySession } from "./key-session"

export type { EditInput } from "./key-session"
export type KeyEdits = Pick<KeySession, "nudge" | "rotate">

/**
 * `input` is what the canvas has now; a held Rotate is computed from it once the design has caught up. `held` is
 * whether a Rotate press waits for the next build, for the status line.
 */
export function useKeyEdits(input: EditInput): { edits: KeyEdits; held: boolean } {
  const [resolvedCount, setResolvedCount] = useState(0)
  const [held, setHeld] = useState(false)
  const [session] = useState(() => keySession({ resolved: () => setResolvedCount((count) => count + 1), holding: setHeld }))
  const { builtMark, buildStatus, moveWaiting, circuit } = input
  // After the render that drew the new build, circuit or resolved edit, so a held turn reads them as they are now.
  useEffect(() => session.settle(input), [session, builtMark, buildStatus, moveWaiting, circuit, resolvedCount])
  return { edits: session, held }
}
