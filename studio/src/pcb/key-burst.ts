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

/**
 * The Rotate presses waiting for the design. A group turns about the centre of its parts as the design draws them,
 * and writes positions relative to the code's literals; the two agree only once every position edit sent from the
 * keys has resolved, no dragged move waits for its build, and a build that started after the last edit was sent has
 * finished. A press before then is held, and goes when that build lands.
 */
export interface TurnGate {
  /** Position edits sent from the keys that have not resolved. */
  inFlight: number
  /** When the last of them was sent (ms), until a build that started after it has finished. */
  sentAt: number | undefined
  /** The presses held meanwhile, and the selection they were made on. */
  held: { names: readonly string[]; count: number } | undefined
}

export const OPEN_GATE: TurnGate = { inFlight: 0, sentAt: undefined, held: undefined }

/** What the gate looks at besides itself: when the shown design's build started, and whether a dragged move waits for its build. */
export interface DesignState {
  builtFrom: number
  moveWaiting: boolean
}

/** Whether a turn computed now sees where the last edit put the parts. */
export function gateOpen(gate: TurnGate, design: DesignState): boolean {
  return gate.inFlight === 0 && !design.moveWaiting && (gate.sentAt === undefined || design.builtFrom > gate.sentAt)
}

const sameNames = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((name, i) => name === b[i])

/** A Rotate press: it goes now when the gate is open, else it is held; a repeating key is ignored. */
export function pressTurn(gate: TurnGate, names: readonly string[], repeat: boolean, design: DesignState): { gate: TurnGate; send: boolean } {
  if (repeat) return { gate, send: false }
  if (gateOpen(gate, design) && !gate.held) return { gate, send: true }
  const count = gate.held && sameNames(gate.held.names, names) ? gate.held.count + 1 : 1
  return { gate: { ...gate, held: { names, count } }, send: false }
}

/** The design caught up, or an edit resolved: one held press goes, while the selection is the one it was made on. */
export function releaseTurn(gate: TurnGate, names: readonly string[], design: DesignState): { gate: TurnGate; send: boolean } {
  const { held } = gate
  if (!held || !gateOpen(gate, design)) return { gate, send: false }
  if (!sameNames(held.names, names)) return { gate: { ...gate, held: undefined }, send: false }
  return { gate: { ...gate, held: held.count > 1 ? { ...held, count: held.count - 1 } : undefined }, send: true }
}

/** A position edit went out at `at`. */
export function editSent(gate: TurnGate, at: number): TurnGate {
  return { ...gate, inFlight: gate.inFlight + 1, sentAt: at }
}

/**
 * The edit sent at `at` resolved. A failed one wrote nothing, so no build follows it: unless a later edit was sent,
 * the gate waits again for what it waited for before (`before`), and the held presses are dropped.
 */
export function editSettled(gate: TurnGate, ok: boolean, at: number, before: number | undefined): TurnGate {
  const inFlight = Math.max(0, gate.inFlight - 1)
  if (ok) return { ...gate, inFlight }
  return { inFlight, sentAt: gate.sentAt === at ? before : gate.sentAt, held: undefined }
}

/** The key press the canvas takes (and so keeps from the page): a nudge or a turn needs a selection and no tool using the keys. */
export function claimsKey(action: string, selectionSize: number, paused: boolean, preventDefault: boolean): boolean {
  if (!action.startsWith("nudge") && action !== "rotate") return preventDefault
  return selectionSize > 0 && !paused && preventDefault
}
