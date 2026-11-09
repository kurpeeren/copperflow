// The edits the keys write, kept apart from the key map: one key session per canvas (key-session.ts), the effect
// that lets a held press go once the canvas has drawn the build, circuit or edit it was waiting for, and the app's
// Undo and Redo, which the session waits for as for its own edits (history-writes.ts).
import { useEffect, useState } from "react"
import { onHistoryWrite } from "../history-writes"
import { keySession, type EditInput, type KeySession } from "./key-session"

export type { EditInput } from "./key-session"
export type KeyEdits = Pick<KeySession, "nudge" | "rotate" | "rotateRight" | "align">

/**
 * `input` is what the canvas has now; a held Rotate or arrow press is computed from it once the design has caught up.
 * `held` is whether a press waits for the next build, for the status line.
 */
export function useKeyEdits(input: EditInput): { edits: KeyEdits; held: boolean } {
  const [resolvedCount, setResolvedCount] = useState(0)
  const [held, setHeld] = useState(false)
  const [session] = useState(() => keySession({ resolved: () => setResolvedCount((count) => count + 1), holding: setHeld }))
  const { builtMark, buildStatus, moveWaiting, circuit } = input
  useEffect(() => onHistoryWrite((outcome) => session.historyWrite(outcome)), [session])
  // After the render that drew the new build, circuit or resolved edit, so a held press reads them as they are now.
  useEffect(() => session.settle(input), [session, builtMark, buildStatus, moveWaiting, circuit, resolvedCount])
  return { edits: session, held }
}
