// Attempt limits. A WindowCounter counts events per key in a sliding window and says when a key has reached its
// maximum. Its memory is bounded without ever opening a limited key early or refusing a newcomer: keys under their
// maximum live in one table, evicted oldest first when it is full; keys at their maximum move to a separate bounded
// table and stay there until their window has passed. When that table is full too, `add` says "overflow" and the
// caller slows every attempt down instead (GlobalSlowdown), which never refuses anyone.

export type LimitCheck = { ok: true } | { ok: false; retryAfterS: number }

export const DEFAULT_MAX_OPEN_KEYS = 50_000
export const DEFAULT_MAX_LIMITED_KEYS = 10_000

export class WindowCounter {
  private readonly open = new Map<string, number[]>()
  private readonly limitedKeys = new Map<string, number[]>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxOpen = DEFAULT_MAX_OPEN_KEYS,
    private readonly maxLimited = DEFAULT_MAX_LIMITED_KEYS,
  ) {}

  private live(times: readonly number[], now: number): number[] {
    return times.filter((time) => time > now - this.windowMs)
  }

  private refusal(times: readonly number[], now: number): LimitCheck {
    return { ok: false, retryAfterS: Math.max(1, Math.ceil(((times[times.length - this.max] as number) + this.windowMs - now) / 1000)) }
  }

  /** Whether `key` has reached its maximum in the window. */
  check(key: string, now: number): LimitCheck {
    const held = this.limitedKeys.get(key)
    if (held) {
      const times = this.live(held, now)
      if (times.length >= this.max) return this.refusal(times, now)
      this.limitedKeys.delete(key)
      if (times.length > 0) this.open.set(key, times)
      return { ok: true }
    }
    const times = this.live(this.open.get(key) ?? [], now)
    // A key that could not move to the limited table (overflow) is still limited where it is.
    return times.length >= this.max ? this.refusal(times, now) : { ok: true }
  }

  /** Counts one event for `key`. "overflow" when the key reached its maximum but the limited table is full. */
  add(key: string, now: number): "ok" | "overflow" {
    const held = this.limitedKeys.get(key)
    if (held) {
      this.limitedKeys.set(key, [...this.live(held, now), now].slice(-this.max))
      return "ok"
    }
    const times = [...this.live(this.open.get(key) ?? [], now), now].slice(-this.max)
    this.open.delete(key)
    if (times.length >= this.max) {
      if (this.limitedKeys.size >= this.maxLimited) this.sweepLimited(now)
      if (this.limitedKeys.size < this.maxLimited) {
        this.limitedKeys.set(key, times)
        return "ok"
      }
      this.putOpen(key, times)
      return "overflow"
    }
    this.putOpen(key, times)
    return "ok"
  }

  private putOpen(key: string, times: number[]): void {
    // Full: forget the key touched longest ago. Limited keys are not in this table, so none is opened early.
    while (this.open.size >= this.maxOpen) this.open.delete(this.open.keys().next().value as string)
    this.open.set(key, times)
  }

  private sweepLimited(now: number): void {
    for (const [key, times] of this.limitedKeys) if (this.live(times, now).length < this.max) this.limitedKeys.delete(key)
  }

  get size(): { open: number; limited: number } {
    return { open: this.open.size, limited: this.limitedKeys.size }
  }
}

/**
 * The global brake on failed sign-ins: past `threshold` failures in the window (or while forced after an overflow),
 * every sign-in attempt waits a little longer. It never refuses, so nobody can lock everyone out.
 */
export class GlobalSlowdown {
  private times: number[] = []
  private forcedUntil = 0
  private announcedAt = Number.NEGATIVE_INFINITY

  constructor(
    private readonly threshold: number,
    private readonly windowMs: number,
  ) {}

  fail(now: number): void {
    this.times.push(now)
    if (this.times.length > this.threshold) this.times = this.times.slice(-this.threshold)
  }

  /** Slows everyone down for one window (a limiter table overflowed). */
  force(now: number): void {
    this.forcedUntil = now + this.windowMs
  }

  slowed(now: number): boolean {
    return this.forcedUntil > now || (this.times.length >= this.threshold && (this.times[0] as number) > now - this.windowMs)
  }

  /** True once per window while slowed, so the audit log says it once. */
  announce(now: number): boolean {
    if (now - this.announcedAt < this.windowMs) return false
    this.announcedAt = now
    return true
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
