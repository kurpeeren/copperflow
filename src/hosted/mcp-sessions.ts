// The MCP sessions of one HTTP server: per-user and server-wide limits, reservations taken before any await (so
// concurrent initialises cannot all pass the check), idle and absolute lifetimes, and fair-share eviction.

export class SessionRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export interface SessionLimits {
  /** Sessions on the whole server, registered and pending. */
  maxSessions: number
  /** Sessions one user may hold, registered and pending. */
  maxPerUser: number
  /** A session nobody used for this long is closed (never while a stream is open). */
  idleMs: number
  /** Every session is closed this long after it opened, streams or not. */
  lifetimeMs: number
}

interface Entry {
  user: string
  lastSeen: number
  streams: number
  close: () => void
  idle?: NodeJS.Timeout | undefined
  life: NodeJS.Timeout
}

/** A slot held for a session being initialised: registered with `commit`, or given back with `release`. */
export interface Reservation {
  commit(id: string, close: () => void): void
  release(): void
}

export class SessionTable {
  private readonly sessions = new Map<string, Entry>()
  private readonly pending = new Map<string, number>()
  private pendingTotal = 0

  constructor(private readonly limits: SessionLimits) {}

  get size(): number {
    return this.sessions.size
  }

  userOf(id: string): string | undefined {
    return this.sessions.get(id)?.user
  }

  /**
   * Holds a slot for `user`, synchronously. At their own limit their longest-idle session without a stream goes, or
   * 429. With the server full, the longest-idle session of a user above their fair share (the cap divided by the
   * users holding sessions) goes, or 429. Nobody within their fair share loses a session to another user.
   */
  reserve(user: string): Reservation {
    if (this.countOf(user) >= this.limits.maxPerUser) {
      const idle = this.longestIdle((entry) => entry.user === user && entry.streams === 0)
      if (idle === undefined) throw new SessionRefusal(429, "Too many open sessions for this user")
      this.close(idle)
    }
    if (this.sessions.size + this.pendingTotal >= this.limits.maxSessions) {
      const over = this.overShare(user)
      const victim = this.longestIdle((entry) => over.has(entry.user))
      if (victim === undefined) throw new SessionRefusal(429, "Too many open sessions")
      this.close(victim)
    }
    this.pending.set(user, (this.pending.get(user) ?? 0) + 1)
    this.pendingTotal += 1
    let open = true
    const giveBack = () => {
      if (!open) return false
      open = false
      this.pending.set(user, (this.pending.get(user) ?? 1) - 1)
      this.pendingTotal -= 1
      return true
    }
    return {
      commit: (id, close) => {
        if (!giveBack()) return
        const entry: Entry = { user, lastSeen: Date.now(), streams: 0, close, life: setTimeout(() => this.close(id), this.limits.lifetimeMs) }
        this.sessions.set(id, entry)
        this.touch(id)
      },
      release: () => void giveBack(),
    }
  }

  /** Marks a session used; while a stream is open no idle timer runs. */
  touch(id: string): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    clearTimeout(entry.idle)
    entry.lastSeen = Date.now()
    entry.idle = entry.streams > 0 ? undefined : setTimeout(() => this.close(id), this.limits.idleMs)
  }

  streamOpened(id: string): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    entry.streams += 1
    this.touch(id)
  }

  streamClosed(id: string): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    entry.streams = Math.max(0, entry.streams - 1)
    this.touch(id)
  }

  /** Forgets a session the transport closed itself. */
  forget(id: string): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    this.sessions.delete(id)
    clearTimeout(entry.idle)
    clearTimeout(entry.life)
  }

  /** Closes a session: forgets it and closes its transport. */
  close(id: string): void {
    const entry = this.sessions.get(id)
    if (!entry) return
    this.forget(id)
    entry.close()
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }

  private countOf(user: string): number {
    let count = this.pending.get(user) ?? 0
    for (const entry of this.sessions.values()) if (entry.user === user) count += 1
    return count
  }

  /** The users holding more than the cap divided among everyone holding or asking for a session. */
  private overShare(asking: string): Set<string> {
    const users = new Set<string>([asking])
    for (const entry of this.sessions.values()) users.add(entry.user)
    for (const [user, count] of this.pending) if (count > 0) users.add(user)
    const share = Math.max(1, Math.floor(this.limits.maxSessions / users.size))
    return new Set([...users].filter((user) => this.countOf(user) > share))
  }

  private longestIdle(match: (entry: Entry) => boolean): string | undefined {
    let found: [string, Entry] | undefined
    for (const item of this.sessions) if (match(item[1]) && (!found || item[1].lastSeen < found[1].lastSeen)) found = item
    return found?.[0]
  }
}
