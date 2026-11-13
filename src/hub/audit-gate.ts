// The one rule for every audit row (docs/hosted.md, "Tables that a signed-in user's requests add rows to"). Rows are
// counted per (kind, actor) in fixed windows of 15 minutes: the first 20 of a window are written in full, the 21st
// writes one `audit-summarised` row instead, later events are only counted, and when the window ends one `audit-count`
// row says how many were only counted. So one actor writes at most 22 rows of a kind per window and no event is lost.
// Per kind the hub writes at most 5 000 full rows per window; beyond that events whose actor is an address are counted
// under the one actor `many`, which keeps who did it as far as bounded storage allows: the total, the number of distinct
// addresses (exact up to 10 000) and the 100 busiest addresses with their counts. The address state is at most 100 000
// keys; an event with a new address key beyond that is merged into `many` too. Events of a signed-in user are always
// tracked under that user and are subject to neither cap: their keys are bounded by accounts x kinds. Nothing is ever
// refused or delayed.
import { addressKey } from "./limits.js"

export const AUDIT_WINDOW_MS = 15 * 60_000
export const AUDIT_FULL_ROWS_PER_KEY = 20
export const AUDIT_FULL_ROWS_PER_KIND = 5_000
export const AUDIT_MAX_KEYS = 100_000
/** The actor of events counted together: past the hub-wide row budget of a kind, or when the key table is full. */
export const MANY = "many"
/** The actor of the maintainer's commands. */
export const MAINTAINER = "maintainer"
/** Distinct addresses `many` remembers per kind and window (past it a new address is only added to the total). */
export const MANY_DISTINCT_LIMIT = 10_000
/** The busiest addresses a `many` count row names. */
export const MANY_TOP = 100

export interface AuditGateOptions {
  windowMs?: number
  fullPerKey?: number
  fullPerKind?: number
  maxKeys?: number
}

/** What to do with one event. */
export type Verdict = "write" | "summarise" | "count"

/** A window that ended with events that were only counted. */
export interface EndedCount {
  kind: string
  actor: string
  /** Whether the actor is a user id (its rows carry the user id), else an address key, `many` or `maintainer`. */
  isUser: boolean
  count: number
  from: number
  to: number
  /** For `many` only: the distinct addresses merged (exact up to MANY_DISTINCT_LIMIT), and the busiest with their counts. */
  distinct?: number
  moreDistinctThanLimit?: boolean
  top?: [string, number][]
}

interface Key {
  kind: string
  actor: string
  isUser: boolean
  start: number
  events: number
  counted: number
  /** `many` only: events per merged address, at most MANY_DISTINCT_LIMIT addresses. */
  addresses?: Map<string, number>
  overflowed?: boolean
}

/** The actor of an event: the maintainer for a command, the user id when it has one, else the address key the limiters use. */
export function actorOf(userId: string | null, address: string): { actor: string; isUser: boolean } {
  if (address === "cli") return { actor: MAINTAINER, isUser: false }
  if (userId !== null) return { actor: userId, isUser: true }
  return { actor: addressKey(address), isUser: false }
}

export class AuditGate {
  private readonly keys = new Map<string, Key>()
  /** Signed-in users' keys: no cap here, they are bounded by accounts x kinds. */
  private readonly users = new Map<string, Key>()
  private readonly many = new Map<string, Key>()
  private readonly kinds = new Map<string, { start: number; full: number }>()
  private readonly windowMs: number
  private readonly fullPerKey: number
  private readonly fullPerKind: number
  private readonly maxKeys: number

  constructor(options: AuditGateOptions = {}) {
    this.windowMs = options.windowMs ?? AUDIT_WINDOW_MS
    this.fullPerKey = options.fullPerKey ?? AUDIT_FULL_ROWS_PER_KEY
    this.fullPerKind = options.fullPerKind ?? AUDIT_FULL_ROWS_PER_KIND
    this.maxKeys = options.maxKeys ?? AUDIT_MAX_KEYS
  }

  /** Address keys tracked now (for tests). */
  get size(): number {
    return this.keys.size
  }

  /** Keys of users tracked now (for tests). */
  get userKeys(): number {
    return this.users.size
  }

  private endedOf(key: Key, now: number): boolean {
    return now >= key.start + this.windowMs
  }

  private countOf(key: Key, to: number): EndedCount | undefined {
    if (key.counted === 0) return undefined
    const done: EndedCount = { kind: key.kind, actor: key.actor, isUser: key.isUser, count: key.counted, from: key.start, to }
    if (key.addresses) {
      done.distinct = key.addresses.size
      done.moreDistinctThanLimit = key.overflowed === true
      done.top = [...key.addresses].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, MANY_TOP)
    }
    return done
  }

  /**
   * Decides what to do with one event at `now`; `ended` are counts of windows that ended meanwhile, to be written first.
   * `summaryActor` names who a `summarise` row is about (the actor, or `many` when a kind first spills into it).
   */
  decide(kind: string, actor: string, isUser: boolean, now: number): { verdict: Verdict; ended: EndedCount[]; summaryActor: string; window: number } {
    const ended: EndedCount[] = []
    let window = this.kinds.get(kind)
    if (!window || now >= window.start + this.windowMs) {
      window = { start: now, full: 0 }
      this.kinds.set(kind, window)
    }
    const table = isUser ? this.users : this.keys
    const name = `${kind}\u0000${actor}`
    let key = table.get(name)
    if (key && this.endedOf(key, now)) {
      const done = this.countOf(key, key.start + this.windowMs)
      if (done) ended.push(done)
      table.delete(name)
      key = undefined
    }
    // Only address actors are merged: once the kind's hub-wide budget is spent, or when the address table is full. A
    // user's events are always tracked under that user.
    if (!isUser && (window.full >= this.fullPerKind || (!key && this.keys.size >= this.maxKeys))) {
      let together = this.many.get(kind)
      if (together && this.endedOf(together, now)) {
        const done = this.countOf(together, together.start + this.windowMs)
        if (done) ended.push(done)
        together = undefined
      }
      const first = !together
      if (!together) {
        together = { kind, actor: MANY, isUser: false, start: now, events: 0, counted: 0, addresses: new Map() }
        this.many.set(kind, together)
      }
      together.events += 1
      together.counted += 1
      const seen = together.addresses as Map<string, number>
      if (seen.has(actor)) seen.set(actor, (seen.get(actor) as number) + 1)
      else if (seen.size < MANY_DISTINCT_LIMIT) seen.set(actor, 1)
      else together.overflowed = true
      // The first event a kind merges writes the one summary row naming the kind and the window.
      return { verdict: first ? "summarise" : "count", ended, summaryActor: MANY, window: together.start }
    }
    if (!key) {
      key = { kind, actor, isUser, start: now, events: 0, counted: 0 }
      table.set(name, key)
    }
    key.events += 1
    if (key.events <= this.fullPerKey) {
      window.full += 1
      return { verdict: "write", ended, summaryActor: actor, window: key.start }
    }
    key.counted += 1
    return { verdict: key.events === this.fullPerKey + 1 ? "summarise" : "count", ended, summaryActor: actor, window: key.start }
  }

  /**
   * The counts of windows that ended by `now` (all pending ones with `force`, on an orderly stop), forgotten as they are
   * returned, so the table of keys empties as windows end.
   */
  ended(now: number, force = false): EndedCount[] {
    const out: EndedCount[] = []
    for (const table of [this.keys, this.users]) {
      for (const [name, key] of table) {
        if (!force && !this.endedOf(key, now)) continue
        const done = this.countOf(key, force ? now : key.start + this.windowMs)
        if (done) out.push(done)
        table.delete(name)
      }
    }
    for (const [kind, key] of this.many) {
      if (!force && !this.endedOf(key, now)) continue
      const done = this.countOf(key, force ? now : key.start + this.windowMs)
      if (done) out.push(done)
      this.many.delete(kind)
    }
    for (const [kind, window] of this.kinds) if (force || now >= window.start + this.windowMs) this.kinds.delete(kind)
    return out
  }
}
