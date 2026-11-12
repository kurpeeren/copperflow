// What every hub route shares: the store, the project folders, the runner, the ticket key, the limits, and the
// session of the request (read from its cookie, renewed on use).
import type { IncomingMessage, ServerResponse } from "node:http"
import type { WorkspaceRunner } from "./runner/runner.js"
import type { TicketKeys } from "./keys.js"
import type { ProjectFiles } from "./projects.js"
import type { HubStore, User } from "./store.js"
import { addressKey, GlobalSlowdown, WindowCounter } from "./limits.js"
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
  /** How much longer each sign-in waits while the global slow-down is on. */
  slowDownMs: number
  now: () => number
}

export interface Hub {
  config: HubConfig
  store: HubStore
  files: ProjectFiles
  runner: WorkspaceRunner
  keys: TicketKeys
  limits: Limits
  /** Per-user queues: operations that add projects or bytes run one at a time for a user. */
  userLocks: Map<string, Promise<void>>
  log: (line: string) => void
}

export interface Signed {
  user: User
  sessionHash: string
  formToken: string
}

/**
 * The sign-in limits. All count FAILED password checks only, so a correct password is refused only by (a) or (b):
 * (a) per address (IPv4 whole, IPv6 /64): 10 per 15 minutes, then 429;
 * (b) per email: 20 per 15 minutes, then 429, except for a request carrying that account's device cookie;
 * (c) globally: past 300 per 15 minutes every attempt waits `slowDownMs` longer, nobody is refused;
 * (f) re-authentication of a signed-in user: 10 per 15 minutes keyed on the user id, separate from sign-in.
 */
export interface Limits {
  signinAddress: WindowCounter
  signinEmail: WindowCounter
  signupAddress: WindowCounter
  reauth: WindowCounter
  slowdown: GlobalSlowdown
}

const FIFTEEN_MINUTES = 15 * 60_000
export const MAX_FAILED_SIGNINS = 300
export const ADDRESS_FAILURES = 10
export const EMAIL_FAILURES = 20
export const MAX_DEVICES = 10
const DEVICE_S = 365 * 24 * 60 * 60

export function newLimits(): Limits {
  return {
    signinAddress: new WindowCounter(ADDRESS_FAILURES, FIFTEEN_MINUTES),
    signinEmail: new WindowCounter(EMAIL_FAILURES, FIFTEEN_MINUTES),
    signupAddress: new WindowCounter(20, 60 * 60_000),
    reauth: new WindowCounter(ADDRESS_FAILURES, FIFTEEN_MINUTES),
    slowdown: new GlobalSlowdown(MAX_FAILED_SIGNINS, FIFTEEN_MINUTES),
  }
}

/** Counts a failed sign-in against (a), (b) and (c); a full limiter table turns on the global slow-down. */
export function countSigninFailure(hub: Hub, address: string, email: string): void {
  const now = hub.config.now()
  hub.limits.slowdown.fail(now)
  const overflow = [hub.limits.signinAddress.add(addressKey(address), now), hub.limits.signinEmail.add(email, now)].includes("overflow")
  if (overflow) hub.limits.slowdown.force(now)
}

/** Waits when the global slow-down is on; the audit log says so once per window. */
export async function slowDownIfNeeded(hub: Hub, address: string): Promise<void> {
  const now = hub.config.now()
  if (!hub.limits.slowdown.slowed(now)) return
  if (hub.limits.slowdown.announce(now)) audit(hub, address, null, "signin-slowed-global")
  await new Promise((done) => setTimeout(done, hub.config.slowDownMs))
}

function deviceCookieName(config: HubConfig): string {
  return config.secure ? "__Host-copperflow-device" : "copperflow-device"
}

/** Whether the request carries a remembered device cookie of this user. */
export function knownDevice(hub: Hub, req: IncomingMessage, userId: string): boolean {
  const secret = cookies(req).get(deviceCookieName(hub.config))
  return secret !== undefined && SECRET_TEXT.test(secret) && hub.store.deviceUser(hashSecret(secret)) === userId
}

/** After a successful sign-in: the device cookie to set, unless this device is already remembered for the user. */
export function rememberDevice(hub: Hub, req: IncomingMessage, userId: string): string | undefined {
  if (knownDevice(hub, req, userId)) return undefined
  const secret = newSecret()
  hub.store.addDevice(hashSecret(secret), userId, hub.config.now(), MAX_DEVICES)
  return setCookie(deviceCookieName(hub.config), secret, { secure: hub.config.secure, maxAgeS: DEVICE_S })
}

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
