// What every hub route shares: the store, the project folders, the runner, the ticket key, the limits, and the
// session of the request (read from its cookie, renewed on use).
import type { IncomingMessage, ServerResponse } from "node:http"
import type { WorkspaceRunner } from "./runner/runner.js"
import type { TicketKeys } from "./keys.js"
import type { ProjectFiles } from "./projects.js"
import type { HubStore, User } from "./store.js"
import { addressKey, RateLimiter } from "./limits.js"
import { cookies, setCookie } from "./http.js"
import { formTokenOf, hashSecret, newSecret, sameSecret } from "./secrets.js"

export const SESSION_MS = 14 * 24 * 60 * 60_000
/** A session's expiry is pushed back at most this often, so reading pages does not write the store on every click. */
const RENEW_EVERY_MS = 60_000
const ANONYMOUS_FORM_S = 60 * 60
const SECRET_TEXT = /^[A-Za-z0-9_-]{43}$/

export interface HubConfig {
  publicOrigin: string
  publicHost: string
  /** True when the public origin is https: cookies get Secure and the __Host- prefix. */
  secure: boolean
  trustProxy: boolean
  maxProjects: number
  maxBytes: number
  now: () => number
}

export interface Hub {
  config: HubConfig
  store: HubStore
  files: ProjectFiles
  runner: WorkspaceRunner
  keys: TicketKeys
  limits: { signinAddress: RateLimiter; signinEmail: RateLimiter; signupAddress: RateLimiter; signinFailures: RateLimiter }
  /** Per-user queues: operations that add projects or bytes run one at a time for a user. */
  userLocks: Map<string, Promise<void>>
  log: (line: string) => void
}

export interface Signed {
  user: User
  sessionHash: string
  formToken: string
}

export function newLimits(): Hub["limits"] {
  const fifteenMinutes = 15 * 60_000
  return {
    signinAddress: new RateLimiter(10, fifteenMinutes),
    signinEmail: new RateLimiter(10, fifteenMinutes),
    signupAddress: new RateLimiter(20, 60 * 60_000),
    // Failed password checks across everyone: past this, sign-in answers 429 for all until the window moves on.
    signinFailures: new RateLimiter(MAX_FAILED_SIGNINS, fifteenMinutes),
  }
}

export const MAX_FAILED_SIGNINS = 300

/** Runs `work` after every earlier queued operation of the same user has finished. */
export async function withUserLock<T>(hub: Hub, userId: string, work: () => Promise<T>): Promise<T> {
  const before = hub.userLocks.get(userId) ?? Promise.resolve()
  let release!: () => void
  const mine = new Promise<void>((done) => (release = done))
  const queued = before.then(() => mine)
  hub.userLocks.set(userId, queued)
  await before
  try {
    return await work()
  } finally {
    release()
    if (hub.userLocks.get(userId) === queued) hub.userLocks.delete(userId)
  }
}

/**
 * Counts a password check against the same limits as sign-in: the address (by addressKey), the account's email and
 * the global count of failures. Returns the refusal when one applies.
 */
export function passwordCheckLimit(hub: Hub, address: string, email: string): { ok: false; retryAfterS: number } | undefined {
  const now = hub.config.now()
  const global = hub.limits.signinFailures.check("all", now)
  if (!global.ok) return global
  const byAddress = hub.limits.signinAddress.hit(addressKey(address), now)
  if (!byAddress.ok) return byAddress
  const byEmail = hub.limits.signinEmail.hit(email, now)
  return byEmail.ok ? undefined : byEmail
}

/** Records a failed password check toward the global cap. */
export function countFailure(hub: Hub): void {
  hub.limits.signinFailures.hit("all", hub.config.now())
}

export function sessionCookieName(config: HubConfig): string {
  return config.secure ? "__Host-copperflow-session" : "copperflow-session"
}

function formCookieName(config: HubConfig): string {
  return config.secure ? "__Host-copperflow-form" : "copperflow-form"
}

/** Starts a session for the user and returns its cookie. */
export function startSession(hub: Hub, userId: string): string {
  const secret = newSecret()
  const now = hub.config.now()
  hub.store.createSession(hashSecret(secret), userId, now, now + SESSION_MS)
  return setCookie(sessionCookieName(hub.config), secret, { secure: hub.config.secure, maxAgeS: SESSION_MS / 1000 })
}

export function clearSessionCookie(hub: Hub): string {
  return setCookie(sessionCookieName(hub.config), "", { secure: hub.config.secure, maxAgeS: 0 })
}

/** The request's session, renewed on use; `renewed` is the cookie to send back when it was. */
export function sessionOf(hub: Hub, req: IncomingMessage): { signed?: Signed; renewed?: string } {
  const secret = cookies(req).get(sessionCookieName(hub.config))
  if (secret === undefined || !SECRET_TEXT.test(secret)) return {}
  const sessionHash = hashSecret(secret)
  const now = hub.config.now()
  const session = hub.store.session(sessionHash, now)
  if (!session) return {}
  const user = hub.store.userById(session.userId)
  if (!user) return {}
  const signed = { user, sessionHash, formToken: formTokenOf(secret) }
  if (now - session.lastSeen < RENEW_EVERY_MS) return { signed }
  hub.store.renewSession(sessionHash, now, now + SESSION_MS)
  return { signed, renewed: setCookie(sessionCookieName(hub.config), secret, { secure: hub.config.secure, maxAgeS: SESSION_MS / 1000 }) }
}

/** Whether the form field matches the session's form token. */
export function formTokenMatches(signed: Signed, given: string | undefined): boolean {
  return given !== undefined && sameSecret(given, signed.formToken)
}

/**
 * The form token for a page shown before sign-in: a random value in a short-lived cookie, which the form sends back
 * in a hidden field (a cross-site page can neither read the cookie nor set it).
 */
export function anonymousFormToken(hub: Hub, req: IncomingMessage): { token: string; cookie?: string } {
  const known = cookies(req).get(formCookieName(hub.config))
  if (known !== undefined && SECRET_TEXT.test(known)) return { token: known }
  const token = newSecret()
  return { token, cookie: setCookie(formCookieName(hub.config), token, { secure: hub.config.secure, maxAgeS: ANONYMOUS_FORM_S }) }
}

export function anonymousFormMatches(hub: Hub, req: IncomingMessage, given: string | undefined): boolean {
  const known = cookies(req).get(formCookieName(hub.config))
  return known !== undefined && given !== undefined && SECRET_TEXT.test(known) && sameSecret(known, given)
}

export function audit(hub: Hub, address: string, userId: string | null, event: string, detail = ""): void {
  hub.store.audit({ time: hub.config.now(), userId, event, address, detail })
}

/** Adds the renewed session cookie, if any, to the headers of a response. */
export function withRenewed(renewed: string | undefined, headers: Record<string, string | string[]> = {}): Record<string, string | string[]> {
  return renewed ? { ...headers, "set-cookie": renewed } : headers
}

export type Handler = (hub: Hub, req: IncomingMessage, res: ServerResponse, address: string) => Promise<void>
