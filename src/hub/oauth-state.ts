// What the OAuth flow keeps in memory: authorisation requests waiting for sign-in or consent (10 minutes; at most 3 per
// browser and 5 per signed-in user, each owner dropping only its own oldest; at most 20 per address, refused beyond),
// and issued codes (60 seconds, single use, at most 20 per user). Keys are hashes of random secrets.
import { hashSecret, newSecret } from "./secrets.js"

export const PENDING_MS = 10 * 60_000
export const CODE_MS = 60_000
export const MAX_PENDING = 10_000
/** Owners (browsers and users) with requests, capped on their own. */
const MAX_OWNERS = 10_000
const SWEEP_EVERY_MS = 1000
export const PENDING_PER_BROWSER = 3
export const PENDING_PER_USER = 5
/** A cap that refuses new requests from one address; it never evicts another browser's. */
export const PENDING_PER_ADDRESS = 20
const MAX_CODES = 10_000
const MAX_CODES_PER_USER = 20
const REDEEMED_MS = 10 * 60_000
/** Clients one signed-in user can keep from eviction by authorising them. */
export const PROTECTED_PER_USER = 5

export interface AuthorizationRequest {
  clientId: string
  redirectUri: string
  challenge: string
  state?: string | undefined
  expires: number
  /** Who holds it: "browser:<id>" (a random id in the browser's own cookie) or, once bound, "user:<id>". */
  owner: string
  /** The address key it came from, for the per-address cap. */
  address: string
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
  /** The request keys of each owner, oldest first; kept in step with `pending` by `remove`, empty lists deleted. */
  private readonly byOwner = new Map<string, string[]>()
  /** Live requests per address, for the per-address cap; kept in step by `remove`. */
  private readonly perAddress = new Map<string, number>()
  private sweptAt = Number.NEGATIVE_INFINITY
  private readonly codes = new Map<string, IssuedCode>()
  private readonly redeemed = new Map<string, { userId: string; grantId: string; expires: number }>()

  /** The one way a request leaves: both indexes follow, and an owner or address left with none is deleted. */
  private remove(key: string): void {
    const found = this.pending.get(key)
    if (!found) return
    this.pending.delete(key)
    const keys = (this.byOwner.get(found.owner) ?? []).filter((other) => other !== key)
    if (keys.length > 0) this.byOwner.set(found.owner, keys)
    else this.byOwner.delete(found.owner)
    const left = (this.perAddress.get(found.address) ?? 1) - 1
    if (left > 0) this.perAddress.set(found.address, left)
    else this.perAddress.delete(found.address)
  }

  private sweep(now: number): void {
    for (const [key, value] of this.pending) if (value.expires <= now) this.remove(key)
  }

  /** Requests and owners held now (for tests). */
  sizes(): { pending: number; owners: number; addresses: number } {
    return { pending: this.pending.size, owners: this.byOwner.size, addresses: this.perAddress.size }
  }

  /**
   * Keeps a request under `owner` ("browser:<id>" from the browser's own cookie, or "user:<id>") made from `address`;
   * returns the secret that names it (in a cookie or a form field, never a URL), or undefined when refused. A browser
   * holds at most PENDING_PER_BROWSER: its own oldest goes, never another's. An address with PENDING_PER_ADDRESS live
   * requests, or a full table, refuses new ones and evicts nothing (the caller's bucket keeps the table from filling).
   */
  addRequest(request: Omit<AuthorizationRequest, "expires" | "owner" | "address">, now: number, owner: string, address: string): string | undefined {
    // Expired requests of every owner go before the caps are read (at most once a second, or when a table is full),
    // so abandoned flows free their address again.
    if (now - this.sweptAt >= SWEEP_EVERY_MS || this.pending.size >= MAX_PENDING || this.byOwner.size >= MAX_OWNERS) {
      this.sweep(now)
      this.sweptAt = now
    }
    for (const key of this.byOwner.get(owner) ?? []) if ((this.pending.get(key)?.expires ?? 0) <= now) this.remove(key)
    const mine = this.byOwner.get(owner) ?? []
    const cap = owner.startsWith("user:") ? PENDING_PER_USER : PENDING_PER_BROWSER
    if ((this.perAddress.get(address) ?? 0) - (mine.length >= cap ? 1 : 0) >= PENDING_PER_ADDRESS) return undefined
    for (const key of mine.slice(0, Math.max(0, mine.length - cap + 1))) this.remove(key)
    if (this.pending.size >= MAX_PENDING || (!this.byOwner.has(owner) && this.byOwner.size >= MAX_OWNERS)) return undefined
    const secret = newSecret()
    const key = hashSecret(secret)
    this.pending.set(key, { ...request, owner, address, expires: now + PENDING_MS })
    this.byOwner.set(owner, [...(this.byOwner.get(owner) ?? []), key])
    this.perAddress.set(address, (this.perAddress.get(address) ?? 0) + 1)
    return secret
  }

  /**
   * Binds a request to the signed-in person it was shown to: it moves to their own list, where traffic from anyone not
   * signed in can no longer touch it.
   */
  bindRequest(secret: string, userId: string, now: number): AuthorizationRequest | undefined {
    const key = hashSecret(secret)
    const found = this.request(secret, now)
    if (!found) return undefined
    if (found.userId !== undefined) return found.userId === userId ? found : undefined
    this.remove(key)
    const owner = `user:${userId}`
    for (const old of (this.byOwner.get(owner) ?? []).slice(0, Math.max(0, (this.byOwner.get(owner)?.length ?? 0) - PENDING_PER_USER + 1))) this.remove(old)
    const bound = { ...found, owner, userId }
    this.pending.set(key, bound)
    this.byOwner.set(owner, [...(this.byOwner.get(owner) ?? []), key])
    this.perAddress.set(bound.address, (this.perAddress.get(bound.address) ?? 0) + 1)
    return bound
  }

  /** Forgets one request (a browser that starts a new one drops its last). */
  dropRequest(secret: string | undefined): void {
    if (secret !== undefined) this.remove(hashSecret(secret))
  }

  request(secret: string | undefined, now: number): AuthorizationRequest | undefined {
    if (secret === undefined) return undefined
    const key = hashSecret(secret)
    const found = this.pending.get(key)
    if (found && found.expires <= now) this.remove(key)
    if (!found || found.expires <= now) return undefined
    return found
  }

  /** Removes and returns a request (single use). */
  takeRequest(secret: string | undefined, now: number): AuthorizationRequest | undefined {
    const found = this.request(secret, now)
    if (secret !== undefined) this.remove(hashSecret(secret))
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

  /** Remembers, for 10 minutes, the grant a code was exchanged for, so a second exchange can revoke it (RFC 9700). */
  markRedeemed(secret: string, userId: string, grantId: string, now: number): void {
    makeRoom(this.redeemed, MAX_CODES, now)
    this.redeemed.set(hashSecret(secret), { userId, grantId, expires: now + REDEEMED_MS })
  }

  /** The grant a code was already exchanged for, if it was; the record is used up. */
  takeRedeemed(secret: string, now: number): { userId: string; grantId: string } | undefined {
    const key = hashSecret(secret)
    const found = this.redeemed.get(key)
    this.redeemed.delete(key)
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
    for (const [key, value] of this.pending) if (value.userId === userId) this.remove(key)
  }
}
