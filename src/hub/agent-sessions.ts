// The agents' MCP sessions at the hub: who opened each, with which credential (a personal token or an OAuth grant), and
// how to close it. The limits are mcp-sessions.ts's (4 per user, reserved before any await, idle and absolute
// lifetimes, fair share when the hub is full). Revoking a credential or a user closes their sessions at once, which
// ends any open stream.
import { SessionTable, type Reservation } from "../hosted/mcp-sessions.js"

export interface AgentSessionEntry {
  userId: string
  credential: string
  /** The hashes of the tokens that authenticated its requests (an OAuth client moves to a new one each hour). */
  tokenHashes: Set<string>
  /** Hands a request of this session to its transport. */
  handle: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, body: unknown) => Promise<void>
  /** Closes the session's transport (and with it every open stream). */
  close: () => void
}

export interface AgentLimits {
  maxSessions: number
  maxPerUser: number
  idleMs: number
  lifetimeMs: number
}

const TOUCH_EVERY_MS = 60_000
const MAX_TOUCHED = 100_000

export const DEFAULT_AGENT_LIMITS: AgentLimits = { maxSessions: 512, maxPerUser: 4, idleMs: 30 * 60_000, lifetimeMs: 12 * 60 * 60_000 }

export class AgentSessions {
  private readonly table: SessionTable
  private readonly sessions = new Map<string, AgentSessionEntry>()
  private readonly touched = new Map<string, number>()
  private openServers = 0
  private openUpstreams = 0

  constructor(limits: AgentLimits = DEFAULT_AGENT_LIMITS) {
    this.table = new SessionTable(limits)
  }

  /** Holds a slot for the user, synchronously; throws SessionRefusal (429) at the limits. */
  reserve(userId: string): Reservation {
    return this.table.reserve(userId)
  }

  /** Registers an initialised session in its reservation. */
  register(reservation: Reservation, id: string, entry: AgentSessionEntry): void {
    this.sessions.set(id, entry)
    reservation.commit(id, () => {
      this.sessions.delete(id)
      entry.close()
    })
  }

  get(id: string): AgentSessionEntry | undefined {
    return this.sessions.get(id)
  }

  touch(id: string): void {
    this.table.touch(id)
  }

  streamOpened(id: string): void {
    this.table.streamOpened(id)
  }

  streamClosed(id: string): void {
    this.table.streamClosed(id)
  }

  /** Forgets a session that closed itself. */
  forget(id: string): void {
    this.sessions.delete(id)
    this.table.forget(id)
  }

  get size(): number {
    return this.sessions.size
  }

  private closeWhere(match: (entry: AgentSessionEntry) => boolean): number {
    const doomed = [...this.sessions].filter(([, entry]) => match(entry)).map(([id]) => id)
    for (const id of doomed) this.table.close(id)
    return doomed.length
  }

  closeUser(userId: string): number {
    return this.closeWhere((entry) => entry.userId === userId)
  }

  /** Closes the sessions a revoked token authenticated, and with them their streams. */
  closeToken(hash: string): number {
    return this.closeWhere((entry) => entry.tokenHashes.has(hash))
  }

  closeCredential(credential: string): number {
    return this.closeWhere((entry) => entry.credential === credential)
  }

  /** MCP servers made for sessions and not yet closed, registered or not (for tests: nothing may be left behind). */
  get servers(): number {
    return this.openServers
  }

  /** Connections to workspaces held for agent sessions now (for tests: none may outlive a revocation). */
  get upstreams(): number {
    return this.openUpstreams
  }

  upstreamOpened(): void {
    this.openUpstreams += 1
  }

  upstreamClosed(): void {
    this.openUpstreams -= 1
  }

  serverOpened(): void {
    this.openServers += 1
  }

  serverClosed(): void {
    this.openServers -= 1
  }

  /** Whether a personal token's last-used time is due to be written: at most once a minute per token. */
  shouldTouch(tokenId: string, now: number): boolean {
    const last = this.touched.get(tokenId)
    if (last !== undefined && now - last < TOUCH_EVERY_MS) return false
    // Bounded: tokens are at most 10 per account; past this size the memory is simply started afresh.
    if (this.touched.size >= MAX_TOUCHED) this.touched.clear()
    this.touched.set(tokenId, now)
    return true
  }

  closeAll(): void {
    this.table.closeAll()
    this.sessions.clear()
  }
}
