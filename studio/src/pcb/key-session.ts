// What the arrow keys and Rotate send, apart from React. Arrow presses merge into bursts (key-burst.ts) and move only
// the parts the open view draws; a Rotate press waits at the turn gate until the design shows where the last edit put
// the parts, so two quick presses turn the group twice about the same centre. Align and distribute wait at the same
// gate (each is computed from the parts' positions), so two quick ones do not scatter the parts. After an Undo or Redo from the app
// (history-writes.ts) both wait for the build that read it. On the schematic an arrow move or an align carries the
// corners of the wires at the moved pins in its own edit, and an arrow move carries the selected wires (wire-follow.ts);
// the canvas draws an arrow move's parts and wires where it puts them until its build lands (move-preview.ts). use-key-edits.ts holds one session per
// canvas. Plain TypeScript with .js imports, so the tests can run it.
import type { WriteOutcome } from "../history-writes.js"
import type { Selection } from "../selection.js"
import { nudgeDirection, type KeyResult } from "./canvas-keys.js"
import { alignPlan } from "./align.js"
import type { AlignCommand } from "./align-rules.js"
import { nudgeOffset, nudgePlan, rotatePlan, sendGroupEditMarked, type GroupEdit, type GroupEditActions, type Layout } from "./group-edits.js"
import {
  editSent,
  editSettled,
  historySent,
  historySettled,
  holdNudge,
  OPEN_GATE,
  pressArrow,
  pressNudge,
  pressTurn,
  releaseArrows,
  releaseTurn,
  settleNudge,
  type Burst,
  type DesignState,
  type HeldArrows,
  type TurnGate,
} from "./key-burst.js"
import type { Point } from "./geometry.js"
import type { SourceCircuit, Turn, View } from "./positions.js"
import { movePreview, type MovePreview } from "./move-preview.js"
import { withFollowingWires, withMovedWires, type WireFollow } from "./wire-follow.js"

/** What an edit from a key needs, as the canvas has it at this press. */
export interface EditInput extends DesignState {
  view: View
  selection: Selection
  circuit: SourceCircuit
  actions: GroupEditActions
  blockerFor(name: string): string | null
  layout: Layout
  /** The schematic's sheet, whose hand-drawn wires follow a nudge or an align; the PCB has none. */
  follow?: WireFollow
}

export interface KeySession {
  /** An arrow key. */
  nudge(input: EditInput, hit: KeyResult): void
  /** R, Space, or the Rotate command; `repeat` when the key is held down. */
  rotate(input: EditInput, repeat: boolean): void
  /** Rotate right, from the menu or the toolbar: a clockwise quarter turn, through the same gate as Rotate. */
  rotateRight(input: EditInput): void
  /** An align or distribute command, from its key, the menu, the toolbar or the context menu. */
  align(input: EditInput, command: AlignCommand): void
  /** The canvas has drawn a new design, circuit or resolved edit: held presses go when the gate is open. */
  settle(input: EditInput): void
  /** The app sent an Undo or Redo, which resolves to `outcome`; the keys wait for the build that reads it. */
  historyWrite(outcome: Promise<WriteOutcome>): void
}

/** What the session tells the canvas. */
interface SessionEvents {
  /** An edit resolved; the canvas calls settle once it has drawn what came with it. */
  resolved(): void
  /** A Rotate or arrow press is held at the gate (true) or none is (false), told when that changes. */
  holding(on: boolean): void
  /** On the schematic, an arrow move went out: what to draw of it until its build lands, and whether it was written. */
  moved?(preview: MovePreview, sent: Promise<boolean>): void
}

interface State {
  gate: TurnGate
  /** Whether the canvas was last told that a press is held. */
  told: boolean
  /** What each press held at the gate will do, in order (the gate counts them). */
  queue: Press[]
  burst?: Burst<SourceCircuit>
  /** Where the parts sat when the burst began. */
  layout?: Layout
  /** Arrow presses held while an Undo or Redo is waited for. */
  arrows?: HeldArrows
}

/** What a press at the gate does once it goes. */
type Press = "rotate" | "rotateRight" | AlignCommand

/** Tells the canvas when a press starts or stops being held, so its status line can say so. */
function tell(state: State, events: SessionEvents): void {
  if (!state.gate.held) state.queue = []
  const held = state.gate.held !== undefined || state.arrows !== undefined
  if (held === state.told) return
  state.told = held
  events.holding(held)
}

/** Sends a position edit through the gate, so a Rotate after it waits for its build; resolves to whether it went through. */
function send(state: State, events: SessionEvents, plan: GroupEdit, input: EditInput): Promise<boolean> {
  const before = state.gate.waiting
  if (plan.edits.length > 0) state.gate = editSent(state.gate)
  const { seq } = state.gate
  return sendGroupEditMarked(plan, input.actions).then(({ ok, mark }) => {
    if (plan.edits.length > 0) state.gate = editSettled(state.gate, ok, seq, before, mark)
    tell(state, events)
    events.resolved()
    return ok
  })
}

/** Turns the selection about its centre as the design draws it. */
function turn(state: State, events: SessionEvents, input: EditInput, quarter: Turn): void {
  const plan = rotatePlan(input.circuit, input.selection.names, input.view, input.layout, input.blockerFor, quarter)
  if ("message" in plan) return input.actions.notify(plan.message)
  void send(state, events, plan, input)
}

/** Aligns or distributes the selection as the design draws it. */
function alignSelection(state: State, events: SessionEvents, input: EditInput, command: AlignCommand): void {
  const plan = alignPlan(input.circuit, input.selection.names, input.view, input.layout, command, input.blockerFor)
  if ("message" in plan) return input.actions.notify(plan.message)
  void send(state, events, withFollowingWires(plan, input.circuit, input.follow), input)
}

/** Does what a press at the gate asked for. */
function perform(state: State, events: SessionEvents, input: EditInput, press: Press): void {
  if (press === "rotate") turn(state, events, input, 90)
  else if (press === "rotateRight") turn(state, events, input, -90)
  else alignSelection(state, events, input, press)
}

/** A press at the gate: it goes now, or is held with what it will do. */
function press(state: State, events: SessionEvents, input: EditInput, what: Press, repeat: boolean): void {
  const step = pressTurn(state.gate, input.selection.names, repeat, input)
  state.gate = step.gate
  if (step.send) perform(state, events, input, what)
  else if (!repeat) state.queue = (state.gate.held?.count ?? 0) > 1 ? [...state.queue, what] : [what]
  tell(state, events)
}

/** Writes the burst's total offset from where it began, its parts and wires; when that resolves, sends what was merged meanwhile. */
function sendNudge(state: State, events: SessionEvents, input: EditInput, total: Point): void {
  const { burst, layout } = state
  if (!burst || !layout) return
  const parts = nudgePlan(burst.base, burst.names, input.view, layout, total, input.blockerFor)
  const { plan, lines } = withMovedWires(parts, burst.base, input.follow, { wires: burst.wires ?? [], offset: total })
  const sent = send(state, events, plan, input)
  if (input.follow && plan.edits.length > 0) events.moved?.(movePreview(input.follow.design, plan, lines), sent)
  void sent.then((ok) => {
    if (state.burst !== burst && state.burst?.base !== burst.base) return
    const next = state.burst ? settleNudge(state.burst, ok) : undefined
    state.burst = next?.burst
    if (next?.send) sendNudge(state, events, input, next.send)
  })
}

/** Moves the selection by `delta`: the press joins the burst, or begins one from the circuit as it is now. */
function arrow(state: State, events: SessionEvents, input: EditInput, delta: Point): void {
  const step = pressNudge(state.burst, input.circuit, input.selection.names, delta, input.selection.wires)
  state.burst = step.burst
  if (step.fresh) state.layout = input.layout
  if (step.send) sendNudge(state, events, input, step.send)
}

/**
 * An Undo or Redo went out: the gate waits for it, and the burst ends, so the next arrow moves from what it left. A
 * failed one releases the gate at once: what was held for it goes on the next settle, against the design as it is.
 */
function historyWrite(state: State, events: SessionEvents, outcome: Promise<WriteOutcome>): void {
  const before = { waiting: state.gate.waiting, history: state.gate.history }
  state.gate = historySent(state.gate)
  state.burst = undefined
  const { seq } = state.gate
  void outcome
    .catch((): WriteOutcome => ({ ok: false }))
    .then(({ ok, mark }) => {
      state.gate = historySettled(state.gate, ok, seq, before, mark)
      tell(state, events)
      events.resolved()
    })
}

export function keySession(events: SessionEvents): KeySession {
  const state: State = { gate: OPEN_GATE, told: false, queue: [] }
  return {
    nudge(input, hit) {
      const direction = nudgeDirection(hit.action)
      if (!direction || input.selection.total === 0) return
      const delta = nudgeOffset(direction, input.layout.step, hit.steps ?? 1, input.layout.snap !== false)
      const press = pressArrow(state.gate, input)
      state.gate = press.gate
      if (press.send) arrow(state, events, input, delta)
      else state.arrows = holdNudge(state.arrows, input.selection.names, delta, input.selection.wires)
      tell(state, events)
    },
    rotate(input, repeat) {
      press(state, events, input, "rotate", repeat)
    },
    rotateRight(input) {
      press(state, events, input, "rotateRight", false)
    },
    align(input, command) {
      press(state, events, input, command, false)
    },
    settle(input) {
      const step = releaseTurn(state.gate, input.selection.names, input)
      state.gate = step.gate
      if (step.send) perform(state, events, input, state.queue.shift() ?? "rotate")
      const arrows = releaseArrows(state.gate, state.arrows, input.selection.names, input, input.selection.wires)
      state.gate = arrows.gate
      state.arrows = arrows.held
      if (arrows.send) arrow(state, events, input, arrows.send)
      tell(state, events)
    },
    historyWrite: (outcome) => historyWrite(state, events, outcome),
  }
}
