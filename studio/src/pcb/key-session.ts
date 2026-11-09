// What the arrow keys and Rotate send, apart from React. Arrow presses merge into bursts (key-burst.ts) and move only
// the parts the open view draws; a Rotate press waits at the turn gate until the design shows where the last edit put
// the parts, so two quick presses turn the group twice about the same centre. use-key-edits.ts holds one session per
// canvas. Plain TypeScript with .js imports, so the tests can run it.
import type { Selection } from "../selection.js"
import { nudgeDirection, type KeyResult } from "./canvas-keys.js"
import { nudgeOffset, nudgePlan, rotatePlan, sendGroupEdit, type GroupEdit, type GroupEditActions, type Layout } from "./group-edits.js"
import { editSent, editSettled, OPEN_GATE, pressNudge, pressTurn, releaseTurn, settleNudge, type Burst, type DesignState, type TurnGate } from "./key-burst.js"
import type { Point } from "./geometry.js"
import type { SourceCircuit, View } from "./positions.js"

/** What an edit from a key needs, as the canvas has it at this press. */
export interface EditInput extends DesignState {
  view: View
  selection: Selection
  circuit: SourceCircuit
  actions: GroupEditActions
  blockerFor(name: string): string | null
  layout: Layout
}

export interface KeySession {
  /** An arrow key. */
  nudge(input: EditInput, hit: KeyResult): void
  /** R, Space, or the Rotate command; `repeat` when the key is held down. */
  rotate(input: EditInput, repeat: boolean): void
  /** The canvas has drawn a new design, circuit or resolved edit: a held Rotate goes when the gate is open. */
  settle(input: EditInput): void
}

interface Clock {
  /** An edit resolved; the canvas calls settle once it has drawn what came with it. */
  resolved(): void
  /** A Rotate press is held at the gate (true) or none is (false), told when that changes. */
  holding(on: boolean): void
}

interface State {
  gate: TurnGate
  /** Whether the canvas was last told that a press is held. */
  told: boolean
  burst?: Burst<SourceCircuit>
  /** Where the parts sat when the burst began. */
  layout?: Layout
}

export function keySession(clock: Clock): KeySession {
  const state: State = { gate: OPEN_GATE, told: false }
  /** Tells the canvas when a press starts or stops being held, so its status line can say so. */
  const tell = () => {
    const held = state.gate.held !== undefined
    if (held === state.told) return
    state.told = held
    clock.holding(held)
  }
  /** Sends a position edit through the gate, so a Rotate after it waits for its build; resolves to whether it went through. */
  const send = (plan: GroupEdit, input: EditInput): Promise<boolean> => {
    const before = state.gate.waiting
    if (plan.edits.length > 0) state.gate = editSent(state.gate, input.buildId)
    const { seq } = state.gate
    return sendGroupEdit(plan, input.actions).then((ok) => {
      if (plan.edits.length > 0) state.gate = editSettled(state.gate, ok, seq, before)
      tell()
      clock.resolved()
      return ok
    })
  }
  const turn = (input: EditInput) => {
    const plan = rotatePlan(input.circuit, input.selection.names, input.view, input.layout, input.blockerFor)
    if ("message" in plan) return input.actions.notify(plan.message)
    void send(plan, input)
  }
  /** Writes the burst's total offset from where it began; when that resolves, sends what was merged meanwhile. */
  const sendNudge = (input: EditInput, total: Point): void => {
    const { burst, layout } = state
    if (!burst || !layout) return
    void send(nudgePlan(burst.base, burst.names, input.view, layout, total, input.blockerFor), input).then((ok) => {
      if (state.burst !== burst && state.burst?.base !== burst.base) return
      const next = state.burst ? settleNudge(state.burst, ok) : undefined
      state.burst = next?.burst
      if (next?.send) sendNudge(input, next.send)
    })
  }
  return {
    nudge(input, hit) {
      const direction = nudgeDirection(hit.action)
      if (!direction || input.selection.size === 0) return
      const step = pressNudge(state.burst, input.circuit, input.selection.names, nudgeOffset(direction, input.layout.step, hit.steps ?? 1))
      state.burst = step.burst
      if (step.fresh) state.layout = input.layout
      if (step.send) sendNudge(input, step.send)
    },
    rotate(input, repeat) {
      const step = pressTurn(state.gate, input.selection.names, repeat, input)
      state.gate = step.gate
      if (step.send) turn(input)
      tell()
    },
    settle(input) {
      const step = releaseTurn(state.gate, input.selection.names, input)
      state.gate = step.gate
      if (step.send) turn(input)
      tell()
    },
  }
}
