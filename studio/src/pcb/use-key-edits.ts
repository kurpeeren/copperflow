// The edits the keys write, kept apart from the key map: arrow presses that arrive while an edit is in flight are
// merged into the next one (key-burst.ts), and a Rotate press waits for the last rotate to resolve.
import { useMemo, useRef } from "react"
import type { CircuitData } from "../api"
import { nudgeDirection, type KeyResult } from "./canvas-keys"
import { moveEach, anchorLookup, nudgeOffset, rotatePlan, sendGroupEdit, type GroupEditActions, type Layout } from "./group-edits"
import { acceptRotate, pressNudge, settleNudge, type Burst } from "./key-burst"
import type { View } from "./positions"
import type { Selection } from "../selection"

/** What an edit from a key needs, as the canvas has it at this press. */
export interface EditInput {
  view: View
  selection: Selection
  circuit: CircuitData
  actions: GroupEditActions & { notify(text: string): void }
  blockerFor(name: string): string | null
  layout: Layout
}

interface Session {
  burst?: Burst<CircuitData>
  anchorOf?: ReturnType<typeof anchorLookup>
  rotating: boolean
}

export interface KeyEdits {
  nudge(input: EditInput, hit: KeyResult): void
  rotate(input: EditInput, repeat: boolean): void
}

export function useKeyEdits(): KeyEdits {
  const session = useRef<Session>({ rotating: false })
  const nudge = (input: EditInput, hit: KeyResult) => {
    const direction = nudgeDirection(hit.action)
    if (!direction || input.selection.size === 0) return
    const state = session.current
    const delta = nudgeOffset(direction, input.layout.step, hit.steps ?? 1)
    const step = pressNudge(state.burst, input.circuit, input.selection.names, delta)
    state.burst = step.burst
    if (step.fresh) state.anchorOf = anchorLookup(input.layout.anchors, input.layout.boxes)
    if (step.send) sendNudge(state, input, step.send)
  }
  const rotate = (input: EditInput, repeat: boolean) => {
    const state = session.current
    if (!acceptRotate(repeat, state.rotating)) return
    const plan = rotatePlan(input.circuit, input.selection.names, input.view, input.layout, input.blockerFor)
    if ("message" in plan) return input.actions.notify(plan.message)
    state.rotating = true
    void sendGroupEdit(plan, input.actions).finally(() => {
      state.rotating = false
    })
  }
  return useMemo(() => ({ nudge, rotate }), [])
}

/** Writes the burst's total offset from where the burst began; when it resolves, sends what was merged meanwhile. */
function sendNudge(state: Session, input: EditInput, total: { x: number; y: number }): void {
  const burst = state.burst
  if (!burst || !state.anchorOf) return
  const plan = moveEach(burst.base, burst.names, input.view, state.anchorOf, total, input.blockerFor)
  void sendGroupEdit(plan, input.actions).then((ok) => {
    if (state.burst !== burst && state.burst?.base !== burst.base) return
    const next = state.burst ? settleNudge(state.burst, ok) : undefined
    state.burst = next?.burst
    if (next?.send) sendNudge(state, input, next.send)
  })
}
