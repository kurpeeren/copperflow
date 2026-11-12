// What the OAuth flow keeps in memory: authorisation requests waiting for sign-in or consent (10 minutes), and issued
// codes (60 seconds, single use). Both tables are bounded: a full table drops its oldest entry, so nobody can fill it
// to lock others out (the person whose request was dropped starts again). Keys are hashes of random secrets.
import { hashSecret, newSecret } from "./secrets.js"

export const PENDING_MS = 10 * 60_000
export const CODE_MS = 60_000
const MAX_PENDING = 10_000
const MAX_CODES = 10_000
const MAX_CODES_PER_USER = 20
/** Clients one signed-in user can keep from eviction by authorising them. */
export const PROTECTED_PER_USER = 5

export interface AuthorizationRequest {
  clientId: string
  redirectUri: string
  challenge: string
  state?: string | undefined
  expires: number
  /** Set when the consent page is shown to a signed-in person: only they may answer it. */
  userId?: string | undefined
}

export interface IssuedCode {
  clientId: string
  redirectUri: string
  challenge: string
  userId: string
  expires: number
  /** The user's revocation epoch when it was issued: a revocation since makes it worthless. */
  epoch: number
}

/** Drops expired entries, then the oldest while the map is full (Map order is insertion order). */
function makeRoom<T extends { expires: number }>(map: Map<string, T>, max: number, now: number): void {
  if (map.size < max) return
  for (const [key, value] of map) if (value.expires <= now) map.delete(key)
  while (map.size >= max) map.delete(map.keys().next().value as string)
}

export class OAuthState {
  private readonly pending = new Map<string, AuthorizationRequest>()
  private readonly codes = new Map<string, IssuedCode>()

  /** Keeps a request; returns the secret that names it (in a cookie or a form field, never a URL). */
  addRequest(request: Omit<AuthorizationRequest, "expires">, now: number): string {
    makeRoom(this.pending, MAX_PENDING, now)
    const secret = newSecret()
    this.pending.set(hashSecret(secret), { ...request, expires: now + PENDING_MS })
    return secret
  }

  request(secret: string | undefined, now: number): AuthorizationRequest | undefined {
    if (secret === undefined) return undefined
    const found = this.pending.get(hashSecret(secret))
    if (!found || found.expires <= now) return undefined
    return found
  }

  /** Removes and returns a request (single use). */
  takeRequest(secret: string | undefined, now: number): AuthorizationRequest | undefined {
    const found = this.request(secret, now)
    if (secret !== undefined) this.pending.delete(hashSecret(secret))
    return found
  }

  /** Issues a code; at most 20 live ones per user (the oldest of theirs goes). */
  addCode(code: Omit<IssuedCode, "expires">, now: number): string {
    makeRoom(this.codes, MAX_CODES, now)
    const mine = [...this.codes].filter(([, value]) => value.userId === code.userId)
    for (const [key] of mine.slice(0, Math.max(0, mine.length - MAX_CODES_PER_USER + 1))) this.codes.delete(key)
    const secret = newSecret()
    this.codes.set(hashSecret(secret), { ...code, expires: now + CODE_MS })
    return secret
  }

  /** Removes and returns a code whatever happens next: a code is good for one attempt. */
  takeCode(secret: string, now: number): IssuedCode | undefined {
    const key = hashSecret(secret)
    const found = this.codes.get(key)
    this.codes.delete(key)
    return found && found.expires > now ? found : undefined
  }

  /**
   * The clients a signed-in person is in the middle of authorising, never evicted from the client table: a request
   * protects its client only once it is bound to a user (the consent page was shown to a session), at most
   * PROTECTED_PER_USER clients per user (their newest), and a live code protects its client. A request from someone
   * not signed in protects nothing, since anyone can make one.
   */
  pendingClients(now: number): Set<string> {
    const ids = new Set<string>()
    const perUser = new Map<string, Set<string>>()
    for (const value of [...this.pending.values()].reverse()) {
      if (value.expires <= now || value.userId === undefined) continue
      const mine = perUser.get(value.userId) ?? new Set<string>()
      if (mine.size >= PROTECTED_PER_USER && !mine.has(value.clientId)) continue
      mine.add(value.clientId)
      perUser.set(value.userId, mine)
      ids.add(value.clientId)
    }
    for (const value of this.codes.values()) if (value.expires > now) ids.add(value.clientId)
    return ids
  }

  /** Forgets every code and request of the user (revocation). */
  forgetUser(userId: string): void {
    for (const [key, value] of this.codes) if (value.userId === userId) this.codes.delete(key)
    for (const [key, value] of this.pending) if (value.userId === userId) this.pending.delete(key)
  }
}
