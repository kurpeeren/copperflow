// Quick presses of one arrow key: while an edit is in flight, the presses that follow are merged into one edit that
// is sent when it resolves. Every edit is computed from the circuit the burst began on and the sum of its presses,
// so a held key moves the selection further each time and never repeats an edit it already sent. Rotate presses wait
// at a gate until the design shows where the last edit put the parts (TurnGate).
import { sameList } from "../selection.js"
import type { Point } from "./geometry.js"

export interface Burst<Base extends object = object> {
  /** The circuit (or anything else that changes identity when the file reloads) the burst began on. */
  base: Base
  names: readonly string[]
  /** The selected wires the burst carries along, when there are any. */
  wires?: readonly string[]
  /** The sum of every press so far. */
  total: Point
  inFlight: boolean
  /** Presses arrived while an edit was in flight. */
  dirty: boolean
}

export interface BurstStep<Base extends object> {
  burst: Burst<Base>
  /** The total offset to send now, or null when nothing is sent. */
  send: Point | null
  /** The press began a new burst. */
  fresh: boolean
}

const sum = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })

/** The wires as a burst or held presses keep them: only when there are any. */
const withWires = (wires: readonly string[]): { wires?: readonly string[] } => (wires.length > 0 ? { wires } : {})

/**
 * A press of `delta` on the parts `names` and the selected `wires`. It joins the burst while the edit is in flight or
 * the circuit has not reloaded; else, or on another selection, it starts a new one.
 */
export function pressNudge<Base extends object>(burst: Burst<Base> | undefined, base: Base, names: readonly string[], delta: Point, wires: readonly string[] = []): BurstStep<Base> {
  const same = burst !== undefined && sameList(burst.names, names) && sameList(burst.wires ?? [], wires)
  if (burst && same && burst.inFlight) {
    return { burst: { ...burst, total: sum(burst.total, delta), dirty: true }, send: null, fresh: false }
  }
  if (burst && same && burst.base === base) {
    const total = sum(burst.total, delta)
    return { burst: { ...burst, total, inFlight: true, dirty: false }, send: total, fresh: false }
  }
  return { burst: { base, names, ...withWires(wires), total: delta, inFlight: true, dirty: false }, send: delta, fresh: true }
}

/** The edit resolved: send what was merged meanwhile, else let go; a failure ends the burst. */
export function settleNudge<Base extends object>(burst: Burst<Base>, ok: boolean): BurstStep<Base> | undefined {
  if (!ok) return undefined
  if (burst.dirty) return { burst: { ...burst, dirty: false, inFlight: true }, send: burst.total, fresh: false }
  return { burst: { ...burst, inFlight: false }, send: null, fresh: false }
}

/** The server's build status, as the Studio loads it. */
export type BuildStatus = "idle" | "building" | "done" | "failed"

/**
 * The Rotate presses waiting for the design. A group turns about the centre of its parts as the design draws them,
 * and writes positions relative to the code's literals; the two agree only once every position edit sent from the
 * keys has resolved, no dragged move waits for its build, and a build that started after the last edit was written
 * has succeeded. The server orders the two with one counter (LiveProject.nextMark): the edit's response carries the
 * mark taken when it was written, and each build state the mark taken when that build started. A build whose start
 * mark is larger read the edit; the status must be done, so a failed build keeps the gate shut until a successful
 * one. A press before then is held, and goes when that build lands. No clock is compared, and a build that finished
 * after the edit but started before it cannot open the gate.
 */
export interface TurnGate {
  /** Position edits sent from the keys that have not resolved. */
  inFlight: number
  /** How many edits have been sent; names each one. */
  seq: number
  /** The last edit sent, until a build that started after the edits has succeeded. */
  waiting: { seq: number } | undefined
  /** The largest write mark among the resolved edits. */
  written: number
  /** The presses held meanwhile, and the selection they were made on. */
  held: { names: readonly string[]; count: number } | undefined
  /**
   * The last Undo or Redo sent (the app's, through history-writes.ts), until the gate opens after it. It is waited
   * for as a key edit is, and the arrows wait for it too (pressArrow).
   */
  history: { seq: number } | undefined
}

export const OPEN_GATE: TurnGate = { inFlight: 0, seq: 0, waiting: undefined, written: 0, held: undefined, history: undefined }

/** What the gate looks at besides itself: the shown build's start mark and the build status, and whether a dragged move waits for its build. */
export interface DesignState {
  builtMark: number | undefined
  buildStatus: BuildStatus
  moveWaiting: boolean
}

/** Whether a turn computed now sees where the last edit put the parts. */
export function gateOpen(gate: TurnGate, design: DesignState): boolean {
  if (gate.inFlight > 0 || design.moveWaiting) return false
  if (gate.waiting === undefined) return true
  return design.buildStatus === "done" && design.builtMark !== undefined && design.builtMark > gate.written
}

/** The gate once it is open: nothing is waited for any more, so a later failed build leaves it open. */
const settled = (gate: TurnGate, design: DesignState): TurnGate =>
  gate.waiting && gateOpen(gate, design) ? { ...gate, waiting: undefined, history: undefined } : gate

/** A Rotate press: it goes now when the gate is open, else it is held; a repeating key is ignored. */
export function pressTurn(gate: TurnGate, names: readonly string[], repeat: boolean, design: DesignState): { gate: TurnGate; send: boolean } {
  if (repeat) return { gate, send: false }
  if (gateOpen(gate, design) && !gate.held) return { gate: settled(gate, design), send: true }
  const count = gate.held && sameList(gate.held.names, names) ? gate.held.count + 1 : 1
  return { gate: { ...gate, held: { names, count } }, send: false }
}

/** The design caught up, or an edit resolved: one held press goes, while the selection is the one it was made on. */
export function releaseTurn(gate: TurnGate, names: readonly string[], design: DesignState): { gate: TurnGate; send: boolean } {
  const { held } = gate
  if (!held || !gateOpen(gate, design)) return { gate: held ? gate : settled(gate, design), send: false }
  const open = settled(gate, design)
  if (!sameList(held.names, names)) return { gate: { ...open, held: undefined }, send: false }
  return { gate: { ...open, held: held.count > 1 ? { ...held, count: held.count - 1 } : undefined }, send: true }
}

/** A position edit went out. */
export function editSent(gate: TurnGate): TurnGate {
  const seq = gate.seq + 1
  return { ...gate, inFlight: gate.inFlight + 1, seq, waiting: { seq } }
}

/**
 * Edit number `seq` resolved, written at server mark `mark`. A failed one wrote nothing, so no build follows it:
 * unless a later edit was sent, the gate waits again for what it waited for before (`before`), and the held presses
 * are dropped.
 */
export function editSettled(gate: TurnGate, ok: boolean, seq: number, before: TurnGate["waiting"], mark?: number): TurnGate {
  const inFlight = Math.max(0, gate.inFlight - 1)
  if (ok) return { ...gate, inFlight, written: Math.max(gate.written, mark ?? 0) }
  return { ...gate, inFlight, waiting: gate.waiting?.seq === seq ? before : gate.waiting, held: undefined }
}

/** An Undo or Redo went out: the gate waits for it as for a key edit, and the arrows wait for it too. */
export function historySent(gate: TurnGate): TurnGate {
  const sent = editSent(gate)
  return { ...sent, history: { seq: sent.seq } }
}

/** What the gate waited for when an Undo or Redo went out, so a failed one can put it back. */
export type GateWait = Pick<TurnGate, "waiting" | "history">

/**
 * Undo or Redo number `seq` resolved, written at server mark `mark`. A failed one wrote nothing, so no build follows
 * it: the gate stops waiting for it at once and waits again only for what it waited for before (`before`, nothing or
 * an earlier write whose build will come). The presses held for it are kept and go as soon as that is met, so a
 * failed Ctrl+Z never holds them waiting for a build.
 */
export function historySettled(gate: TurnGate, ok: boolean, seq: number, before: GateWait, mark?: number): TurnGate {
  if (ok) return editSettled(gate, true, seq, before.waiting, mark)
  const mine = (pending: { seq: number } | undefined) => pending?.seq === seq
  const inFlight = Math.max(0, gate.inFlight - 1)
  const waiting = mine(gate.waiting) ? before.waiting : gate.waiting
  return { ...gate, inFlight, waiting, history: mine(gate.history) ? before.history : gate.history }
}

/**
 * An arrow press. Arrows move from the code's literals, so they never wait for their own edits' builds; after an Undo
 * or Redo they wait for the gate to open, as Rotate does, so they move the parts from where it put them.
 */
export function pressArrow(gate: TurnGate, design: DesignState): { gate: TurnGate; send: boolean } {
  if (gate.history === undefined) return { gate, send: true }
  return gateOpen(gate, design) ? { gate: settled(gate, design), send: true } : { gate, send: false }
}

/** Arrow presses held while an Undo or Redo is waited for: their summed offset, and the selection they were made on. */
export interface HeldArrows {
  names: readonly string[]
  /** The selected wires, when there are any. */
  wires?: readonly string[]
  total: Point
}

const sameHeld = (held: HeldArrows, names: readonly string[], wires: readonly string[]) => sameList(held.names, names) && sameList(held.wires ?? [], wires)

/** One more held arrow press: added to the held ones on the same selection (parts and wires), else it replaces them. */
export function holdNudge(held: HeldArrows | undefined, names: readonly string[], delta: Point, wires: readonly string[] = []): HeldArrows {
  return { names, ...withWires(wires), total: held && sameHeld(held, names, wires) ? sum(held.total, delta) : delta }
}

/** The design caught up: the held arrow presses go as one move once the arrows may, on the selection they were made on. */
export function releaseArrows(
  gate: TurnGate,
  held: HeldArrows | undefined,
  names: readonly string[],
  design: DesignState,
  wires: readonly string[] = [],
): { gate: TurnGate; held: HeldArrows | undefined; send: Point | null } {
  if (!held) return { gate, held, send: null }
  const press = pressArrow(gate, design)
  if (!press.send) return { gate, held, send: null }
  return { gate: press.gate, held: undefined, send: sameHeld(held, names, wires) ? held.total : null }
}

/** The actions the canvas's key listener runs (runKey in use-part-keys.ts). */
const CANVAS_RUNS: ReadonlySet<string> = new Set(["fit", "highlight", "contextMenu", "delete", "rotate", "nudgeLeft", "nudgeRight", "nudgeUp", "nudgeDown", "alignLeft", "distributeH"])

/**
 * Whether the canvas takes the key press (and so keeps it from the page and the later listeners): only an action it
 * runs, and a nudge or a turn only with a selection and no tool using the keys. A turn needs parts (`selectionSize`);
 * a nudge moves any object selected (`objects`, parts and wires). Ctrl+Z, Shift+F, Alt+W and the other keys that the
 * app, the workspace or a tool runs are left to that listener, which prevents them itself.
 */
export function claimsKey(action: string, selectionSize: number, paused: boolean, preventDefault: boolean, objects = selectionSize): boolean {
  if (!preventDefault || !CANVAS_RUNS.has(action)) return false
  if (action.startsWith("nudge")) return objects > 0 && !paused
  if (action === "rotate") return selectionSize > 0 && !paused
  if (action === "alignLeft" || action === "distributeH") return !paused
  return true
}
