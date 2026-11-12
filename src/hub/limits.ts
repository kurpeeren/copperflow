// Sign-in limits (the design and its reasons are in docs/hosted.md, "Sign-in limits").
//
// WindowCounter counts events per key in a sliding window. It never forgets a key that still has live events, and it
// never refuses anyone because it is full: a new key that does not fit is simply not counted, and `add` says "full"
// so the caller turns on strict mode. SigninGate is strict mode: a token bucket with a short queue for sign-in attempts
// that carry no device cookie for the account they name.

import { createHmac, randomBytes } from "node:crypto"

export type LimitCheck = { ok: true } | { ok: false; retryAfterS: number }

export const DEFAULT_MAX_KEYS = 100_000

export class WindowCounter {
  private readonly events = new Map<string, number[]>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = DEFAULT_MAX_KEYS,
  ) {}

  private live(key: string, now: number): number[] {
    const times = (this.events.get(key) ?? []).filter((time) => time > now - this.windowMs)
    if (times.length === 0) this.events.delete(key)
    else this.events.set(key, times)
    return times
  }

  /** Whether `key` has reached its maximum in the window. */
  check(key: string, now: number): LimitCheck {
    const times = this.live(key, now)
    if (times.length < this.max) return { ok: true }
    return { ok: false, retryAfterS: Math.max(1, Math.ceil(((times[times.length - this.max] as number) + this.windowMs - now) / 1000)) }
  }

  /** Counts one event at `now`. "full" when the key is new and the table has no room even after dropping spent keys. */
  add(key: string, now: number): "ok" | "full" {
    const times = this.live(key, now)
    if (times.length === 0 && this.events.size >= this.maxKeys) {
      this.sweep(now)
      if (this.events.size >= this.maxKeys) return "full"
    }
    this.events.set(key, [...times, now])
    return "ok"
  }

  /** Takes back one event counted at `time` (an attempt that turned out right). */
  refund(key: string, time: number): void {
    const times = this.events.get(key)
    if (!times) return
    const at = times.lastIndexOf(time)
    if (at >= 0) times.splice(at, 1)
    if (times.length === 0) this.events.delete(key)
  }

  private sweep(now: number): void {
    for (const [key, times] of this.events) if (times.every((time) => time <= now - this.windowMs)) this.events.delete(key)
  }

  get size(): number {
    return this.events.size
  }
}

/**
 * Failures per email in a fixed table of buckets, indexed by a keyed hash of the email (the key is made at start and
 * never stored or logged). Every email counts alike, existing or not, so the limit says nothing about which accounts
 * exist; the memory is fixed, so nothing can fill it. A collision only makes another email's new devices wait.
 */
export class EmailBuckets {
  private readonly buckets: (number[] | undefined)[]
  private readonly key = randomBytes(32)

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    readonly size = 65_536,
  ) {
    this.buckets = new Array<number[] | undefined>(size)
  }

  private index(email: string): number {
    return createHmac("sha256", this.key).update(email, "utf8").digest().readUInt32BE(0) % this.size
  }

  private live(at: number, now: number): number[] {
    const times = (this.buckets[at] ?? []).filter((time) => time > now - this.windowMs)
    this.buckets[at] = times.length > 0 ? times : undefined
    return times
  }

  check(email: string, now: number): LimitCheck {
    const times = this.live(this.index(email), now)
    if (times.length < this.max) return { ok: true }
    return { ok: false, retryAfterS: Math.max(1, Math.ceil(((times[times.length - this.max] as number) + this.windowMs - now) / 1000)) }
  }

  add(email: string, now: number): void {
    const at = this.index(email)
    // Bounded per bucket: only the newest `max` events matter.
    this.buckets[at] = [...this.live(at, now), now].slice(-this.max)
  }

  refund(email: string, time: number): void {
    const at = this.index(email)
    const times = this.buckets[at]
    if (!times) return
    const found = times.lastIndexOf(time)
    if (found >= 0) times.splice(found, 1)
    if (times.length === 0) this.buckets[at] = undefined
  }

  /** Buckets holding events now (for tests). */
  used(): number {
    return this.buckets.filter((times) => times !== undefined).length
  }
}

export interface GateOptions {
  /** Failures in the window that turn strict mode on. */
  threshold: number
  windowMs: number
  /** Token bucket: attempts per second, and the bucket's size. */
  perSecond: number
  /** Attempts that may wait for a token in all; beyond it they are refused. */
  queue: number
  /** Attempts one address may have waiting. */
  perAddress: number
}

/**
 * Strict mode for sign-in: on while more than `threshold` failures fell in the window, or for one window after a
 * limiter table was full. While on, attempts without a device cookie for their account pass one token bucket; they
 * wait in a short queue, and are refused (429) when the queue is full. Nobody else is ever refused by it.
 */
export class SigninGate {
  private failures: number[] = []
  private strictUntil = 0
  private announcedAt = Number.NEGATIVE_INFINITY
  private tokens: number
  private refilledAt = Date.now()
  /** Waiting attempts per address key, served round-robin across addresses (Map order is the rotation). */
  private readonly waiting = new Map<string, (() => void)[]>()
  private waitingCount = 0
  private timer: NodeJS.Timeout | undefined

  constructor(private readonly options: GateOptions) {
    this.tokens = options.perSecond
  }

  fail(now: number): void {
    this.failures.push(now)
    if (this.failures.length > this.options.threshold + 1) this.failures = this.failures.slice(-(this.options.threshold + 1))
  }

  /** A limiter table was full: strict for one window. */
  enterStrict(now: number): void {
    this.strictUntil = now + this.options.windowMs
  }

  strict(now: number): boolean {
    const over = this.failures.length > this.options.threshold && (this.failures[0] as number) > now - this.options.windowMs
    return over || this.strictUntil > now
  }

  /** True once per window, so the audit log says it once. */
  announce(now: number): boolean {
    if (now - this.announcedAt < this.options.windowMs) return false
    this.announcedAt = now
    return true
  }

  private refill(): void {
    const now = Date.now()
    this.tokens = Math.min(this.options.perSecond, this.tokens + ((now - this.refilledAt) / 1000) * this.options.perSecond)
    this.refilledAt = now
  }

  /**
   * Waits for a token; false (refuse with 429) when this address already has `perAddress` attempts waiting or the
   * queue holds `queue` in all. Waiting addresses are served one attempt each in turn, so one address cannot crowd
   * out the others.
   */
  pass(addressKey: string, gone?: AbortSignal): Promise<boolean> {
    this.refill()
    if (this.waitingCount === 0 && this.tokens >= 1) {
      this.tokens -= 1
      return Promise.resolve(true)
    }
    const mine = this.waiting.get(addressKey) ?? []
    if (gone?.aborted || mine.length >= this.options.perAddress || this.waitingCount >= this.options.queue) return Promise.resolve(false)
    return new Promise((done) => {
      const entry = () => {
        gone?.removeEventListener("abort", leave)
        done(true)
      }
      // A client that goes away leaves the queue at once and takes no token.
      const leave = () => {
        const queue = this.waiting.get(addressKey)
        const at = queue?.indexOf(entry) ?? -1
        if (!queue || at < 0) return
        queue.splice(at, 1)
        if (queue.length === 0) this.waiting.delete(addressKey)
        this.waitingCount -= 1
        done(false)
      }
      gone?.addEventListener("abort", leave, { once: true })
      mine.push(entry)
      this.waiting.set(addressKey, mine)
      this.waitingCount += 1
      this.drain()
    })
  }

  private serveOne(): void {
    const [key, queue] = this.waiting.entries().next().value as [string, (() => void)[]]
    this.waiting.delete(key)
    const next = queue.shift()
    // Back of the rotation when it still has attempts waiting.
    if (queue.length > 0) this.waiting.set(key, queue)
    this.waitingCount -= 1
    this.tokens -= 1
    next?.()
  }

  private drain(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.refill()
      while (this.waitingCount > 0 && this.tokens >= 1) this.serveOne()
      if (this.waitingCount === 0) {
        clearInterval(this.timer)
        this.timer = undefined
      }
    }, Math.ceil(1000 / this.options.perSecond))
    this.timer.unref()
  }

  get queued(): number {
    return this.waitingCount
  }
}

/** The 8 groups of an IPv6 address, or undefined when it is not one. */
function ipv6Groups(address: string): string[] | undefined {
  const parts = address.split("::")
  if (parts.length > 2) return undefined
  const split = (text: string) => (text === "" ? [] : text.split(":"))
  const head = split(parts[0] as string)
  const tail = parts.length === 2 ? split(parts[1] as string) : []
  const missing = 8 - head.length - tail.length
  if (parts.length === 1 ? missing !== 0 : missing < 1) return undefined
  const groups = [...head, ...Array<string>(parts.length === 2 ? missing : 0).fill("0"), ...tail]
  return groups.every((group) => /^[0-9a-f]{1,4}$/i.test(group)) ? groups.map((group) => group.toLowerCase().replace(/^0+(?=.)/, "")) : undefined
}

/** The key an address is limited under: an IPv4 address whole (also when IPv4-mapped), an IPv6 address by its /64. */
export function addressKey(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)
  if (mapped) return mapped[1] as string
  if (!address.includes(":")) return address
  const groups = ipv6Groups(address.split("%")[0] as string)
  return groups ? `${groups.slice(0, 4).join(":")}::/64` : address
}
