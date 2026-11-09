// Quick presses of one arrow key: while an edit is in flight, the presses that follow are merged into one edit that
// is sent when it resolves. Every edit is computed from the circuit the burst began on and the sum of its presses,
// so a held key moves the selection further each time and never repeats an edit it already sent. Rotate presses wait
// at a gate until the design shows where the last edit put the parts (TurnGate).
import type { Point } from "./geometry.js"

export interface Burst<Base extends object = object> {
  /** The circuit (or anything else that changes identity when the file reloads) the burst began on. */
  base: Base
  names: readonly string[]
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

/** A press of `delta`. It joins the burst while the edit is in flight or the circuit has not reloaded; else it starts a new one. */
export function pressNudge<Base extends object>(burst: Burst<Base> | undefined, base: Base, names: readonly string[], delta: Point): BurstStep<Base> {
  const same = burst !== undefined && burst.names.length === names.length && burst.names.every((name, i) => name === names[i])
  if (burst && same && burst.inFlight) {
    return { burst: { ...burst, total: sum(burst.total, delta), dirty: true }, send: null, fresh: false }
  }
  if (burst && same && burst.base === base) {
    const total = sum(burst.total, delta)
    return { burst: { ...burst, total, inFlight: true, dirty: false }, send: total, fresh: false }
  }
  return { burst: { base, names, total: delta, inFlight: true, dirty: false }, send: delta, fresh: true }
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
}

export const OPEN_GATE: TurnGate = { inFlight: 0, seq: 0, waiting: undefined, written: 0, held: undefined }

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
const settled = (gate: TurnGate, design: DesignState): TurnGate => (gate.waiting && gateOpen(gate, design) ? { ...gate, waiting: undefined } : gate)

const sameNames = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((name, i) => name === b[i])

/** A Rotate press: it goes now when the gate is open, else it is held; a repeating key is ignored. */
export function pressTurn(gate: TurnGate, names: readonly string[], repeat: boolean, design: DesignState): { gate: TurnGate; send: boolean } {
  if (repeat) return { gate, send: false }
  if (gateOpen(gate, design) && !gate.held) return { gate: settled(gate, design), send: true }
  const count = gate.held && sameNames(gate.held.names, names) ? gate.held.count + 1 : 1
  return { gate: { ...gate, held: { names, count } }, send: false }
}

/** The design caught up, or an edit resolved: one held press goes, while the selection is the one it was made on. */
export function releaseTurn(gate: TurnGate, names: readonly string[], design: DesignState): { gate: TurnGate; send: boolean } {
  const { held } = gate
  if (!held || !gateOpen(gate, design)) return { gate: held ? gate : settled(gate, design), send: false }
  const open = settled(gate, design)
  if (!sameNames(held.names, names)) return { gate: { ...open, held: undefined }, send: false }
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

/** The actions the canvas's key listener runs (runKey in use-part-keys.ts). */
const CANVAS_RUNS: ReadonlySet<string> = new Set(["fit", "highlight", "contextMenu", "delete", "rotate", "nudgeLeft", "nudgeRight", "nudgeUp", "nudgeDown"])

/**
 * Whether the canvas takes the key press (and so keeps it from the page and the later listeners): only an action it
 * runs, and a nudge or a turn only with a selection and no tool using the keys. Ctrl+Z, Shift+F, Alt+W and the other
 * keys that the app, the workspace or a tool runs are left to that listener, which prevents them itself.
 */
export function claimsKey(action: string, selectionSize: number, paused: boolean, preventDefault: boolean): boolean {
  if (!preventDefault || !CANVAS_RUNS.has(action)) return false
  if (action.startsWith("nudge") || action === "rotate") return selectionSize > 0 && !paused
  return true
}
