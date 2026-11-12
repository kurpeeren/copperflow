// Attempt limits: at most `max` attempts per key in a sliding window. Memory is bounded and the limiter fails closed:
// a key that is limited is never forgotten early; only keys whose attempts have all left the window are dropped, and
// when the table is still full a new key is refused rather than an old one evicted.

export type LimitCheck = { ok: true } | { ok: false; retryAfterS: number }

export class RateLimiter {
  private readonly attempts = new Map<string, number[]>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 50_000,
  ) {}

  /** Counts an attempt for `key` at `now` (ms) when it is allowed; refused attempts are not counted. */
  hit(key: string, now: number): LimitCheck {
    const check = this.check(key, now)
    if (!check.ok) return check
    let times = this.attempts.get(key)
    if (!times) {
      if (this.attempts.size >= this.maxKeys) this.sweep(now)
      // Still full: refuse the newcomer instead of forgetting anyone who is being limited.
      if (this.attempts.size >= this.maxKeys) return { ok: false, retryAfterS: Math.ceil(this.windowMs / 1000) }
      times = []
      this.attempts.set(key, times)
    }
    times.push(now)
    return check
  }

  /** Whether an attempt would be allowed, without counting it. */
  check(key: string, now: number): LimitCheck {
    const times = (this.attempts.get(key) ?? []).filter((time) => time > now - this.windowMs)
    if (times.length === 0) this.attempts.delete(key)
    else this.attempts.set(key, times)
    if (times.length < this.max) return { ok: true }
    return { ok: false, retryAfterS: Math.max(1, Math.ceil(((times[0] as number) + this.windowMs - now) / 1000)) }
  }

  /** Drops only the keys whose attempts have all left the window. */
  private sweep(now: number): void {
    for (const [key, times] of this.attempts) if (times.every((time) => time <= now - this.windowMs)) this.attempts.delete(key)
  }

  get size(): number {
    return this.attempts.size
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
