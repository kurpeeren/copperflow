// Attempt limits: at most `max` attempts per key in a sliding window. Memory is bounded: the oldest keys are dropped
// once `maxKeys` are tracked.

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
    const times = this.attempts.get(key) ?? []
    times.push(now)
    this.attempts.delete(key)
    this.attempts.set(key, times)
    while (this.attempts.size > this.maxKeys) {
      const oldest = this.attempts.keys().next().value as string
      this.attempts.delete(oldest)
    }
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
}
