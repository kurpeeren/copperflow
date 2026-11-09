// Quick presses of one arrow key: while an edit is in flight, the presses that follow are merged into one edit that
// is sent when it resolves. Every edit is computed from the circuit the burst began on and the sum of its presses,
// so a held key moves the selection further each time and never repeats an edit it already sent.
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

/** A Rotate press: ignored when the key is repeating or the last rotate edit has not resolved. */
export function acceptRotate(repeat: boolean, inFlight: boolean): boolean {
  return !repeat && !inFlight
}

/** The key press the canvas takes (and so keeps from the page): a nudge or a turn needs a selection and no tool using the keys. */
export function claimsKey(action: string, selectionSize: number, paused: boolean, preventDefault: boolean): boolean {
  if (!action.startsWith("nudge") && action !== "rotate") return preventDefault
  return selectionSize > 0 && !paused && preventDefault
}
