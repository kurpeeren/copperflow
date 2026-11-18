// Click to place, as one more canvas tool: while a Library part is armed (shell/armed-part.ts) the next left click on
// the canvas places it there with its position written, and the part stays armed for another click. Arming it puts
// the view's other tools away, and arming any of them puts it away; Esc or a right click puts it away too. While the
// AI lock is closed a click places nothing.
import { useCallback, useEffect, useRef } from "react"
import { lockGate } from "../ai-lock-gate.js"
import { disarmPart, placeArmed, takeParts, useArmedPart } from "../shell/armed-part.js"
import type { Point } from "./geometry.js"
import { placedPosition, placeHint } from "./part-place.js"
import type { View } from "./positions.js"
import type { Press } from "./press.js"
import { useDisarmKey } from "./use-disarm-key.js"

const LEFT = 0
const RIGHT = 2

export interface PartPlaceInput {
  view: View
  step: number
  snap: boolean
  /** Another tool of the view is armed or a wire is being drawn. */
  othersArmed: boolean
  /** Puts the view's other tools away. */
  putOthersAway(): void
}

export interface PartPlaceTool {
  armed: boolean
  /** True when the press was the tool's: a left click placed the part, a right click put it away. */
  press(event: Press, world: Point): boolean
  hint: string | undefined
}

/** Arming the part puts the other tools away; arming another tool later puts the part away. */
function useStepAside(part: string | null, othersArmed: boolean, putOthersAway: () => void): void {
  const putAway = useRef(putOthersAway)
  putAway.current = putOthersAway
  useEffect(() => {
    if (part !== null) putAway.current()
  }, [part])
  const before = useRef(othersArmed)
  useEffect(() => {
    if (othersArmed && !before.current) disarmPart()
    before.current = othersArmed
  }, [othersArmed])
}

export function usePartPlaceTool({ view, step, snap, othersArmed, putOthersAway }: PartPlaceInput): PartPlaceTool {
  const part = useArmedPart()
  useEffect(() => takeParts(view), [view])
  useStepAside(part, othersArmed, putOthersAway)
  useDisarmKey(part !== null, disarmPart)
  const press = useCallback(
    (event: Press, world: Point): boolean => {
      if (part === null) return false
      if (event.button === RIGHT) {
        disarmPart()
        return true
      }
      if (event.button !== LEFT) return false
      if (lockGate.refuses()) return true
      placeArmed({ view, props: placedPosition(view, world, step, snap) })
      return true
    },
    [part, view, step, snap],
  )
  return { armed: part !== null, press, hint: part === null ? undefined : placeHint(view, part) }
}
