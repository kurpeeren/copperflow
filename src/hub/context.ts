// What every hub route shares: the store, the project folders, the runner, the ticket key, the limits, and the
// session of the request (read from its cookie, renewed on use).
import type { IncomingMessage, ServerResponse } from "node:http"
import type { WorkspaceRunner } from "./runner/runner.js"
import type { TicketKeys } from "./keys.js"
import type { ProjectFiles } from "./projects.js"
import type { HubStore, User } from "./store.js"
import { addressKey, EmailBuckets, SigninGate, WindowCounter } from "./limits.js"
import { cookies, setCookie } from "./http.js"
import { formTokenOf, hashSecret, newSecret, sameSecret } from "./secrets.js"

export const SESSION_MS = 14 * 24 * 60 * 60_000
/** The longest a session lives from sign-in, renewed or not. */
export const MAX_SESSION_MS = 30 * 24 * 60 * 60_000
/** A session's expiry is pushed back at most this often, so reading pages does not write the store on every click. */
const RENEW_EVERY_MS = 60_000
const ANONYMOUS_FORM_S = 60 * 60
const SECRET_TEXT = /^[A-Za-z0-9_-]{43}$/

export interface HubConfig {
  publicOrigin: string
  publicHost: string
  /** Projects are served on `<project id>.<workspaceDomain>`, never on the public origin. */
  workspaceDomain: string
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
  limits: Limits
  /** Per-user queues: operations that add projects or bytes run one at a time for a user. */
  userLocks: Map<string, Promise<void>>
  /** Per user: aborting it cuts every proxied exchange of that user. */
  userCuts: Map<string, AbortController>
  /** Per user: bumped whenever their sessions are revoked, so a request that waited sees it and stops. */
  epochs: Map<string, number>
  /** One-time tokens that open a project's origin: hash → who, which project, until when, at which epoch. */
  enterTokens: Map<string, { userId: string; projectId: string; expires: number; epoch: number }>
  /** Transfers in progress: uploads in the whole hub, downloads per user. */
  transfers: { uploads: number; downloads: Map<string, number> }
  log: (line: string) => void
}

export interface Signed {
  user: User
  sessionHash: string
  formToken: string
}

/**
 * The sign-in limits (docs/hosted.md, "Sign-in limits"). Every attempt is counted before its first await, as if it
 * failed, and refunded when the password is right, so concurrent attempts cannot pass a check together.
 * (a) per address (IPv4 whole, IPv6 /64): 10 per 15 minutes, then 429, for everyone;
 * (b) per email: 20 per 15 minutes, then 429, except for a request carrying that account's device cookie;
 * (c) strict mode (over 300 failures in 15 minutes, or a full table): attempts without that device cookie pass one
 *     token bucket of 5 per second with a queue of 50, then 429;
 * (f) re-authentication of a signed-in user: 10 per 15 minutes keyed on the user id, separate from sign-in.
 */
export interface Limits {
  signinAddress: WindowCounter
  signinEmail: EmailBuckets
  signupAddress: WindowCounter
  reauth: WindowCounter
  gate: SigninGate
  /** The certificate check (/_tls-ask): 60 per minute per address. */
  tlsAsk: WindowCounter
}

const FIFTEEN_MINUTES = 15 * 60_000
export const MAX_FAILED_SIGNINS = 300
export const ADDRESS_FAILURES = 10
export const EMAIL_FAILURES = 20
export const MAX_DEVICES = 10
const DEVICE_S = 365 * 24 * 60 * 60

export function newLimits(maxKeys?: number): Limits {
  return {
    signinAddress: new WindowCounter(ADDRESS_FAILURES, FIFTEEN_MINUTES, maxKeys),
    signinEmail: new EmailBuckets(EMAIL_FAILURES, FIFTEEN_MINUTES),
    signupAddress: new WindowCounter(20, 60 * 60_000, maxKeys),
    reauth: new WindowCounter(ADDRESS_FAILURES, FIFTEEN_MINUTES, maxKeys),
    tlsAsk: new WindowCounter(60, 60_000, maxKeys),
    gate: new SigninGate({ threshold: MAX_FAILED_SIGNINS, windowMs: FIFTEEN_MINUTES, perSecond: 5, queue: 50, perAddress: 2 }),
  }
}

/** Counts `key` in `counter`; a full table turns strict mode on (said once per window in the audit log). */
export function countAttempt(hub: Hub, counter: WindowCounter, key: string, now: number, address: string): void {
  if (counter.add(key, now) === "ok") return
  // The table is full and this key could not be tracked: strict mode (the gate) handles it for the rest of the window.
  hub.limits.gate.enterStrict(now)
  if (hub.limits.gate.announce(now)) audit(hub, address, null, "signin-strict-table-full")
}

/** In strict mode, an attempt without a device cookie for its account waits for the bucket; false means refuse. */
export async function passGate(hub: Hub, address: string): Promise<boolean> {
  const now = hub.config.now()
  if (!hub.limits.gate.strict(now)) return true
  if (hub.limits.gate.announce(now)) audit(hub, address, null, "signin-strict")
  return hub.limits.gate.pass(addressKey(address))
}

function deviceCookieName(config: HubConfig): string {
  return config.secure ? "__Host-copperflow-device" : "copperflow-device"
}

/**
 * Whether the request carries a remembered device cookie of this user. The lookup runs whether or not the account
 * exists (`userId` undefined), so a known and an unknown email take the same path.
 */
export function knownDevice(hub: Hub, req: IncomingMessage, userId: string | undefined): boolean {
  const secret = cookies(req).get(deviceCookieName(hub.config))
  const owner = secret !== undefined && SECRET_TEXT.test(secret) ? hub.store.deviceUser(hashSecret(secret)) : hub.store.deviceUser(hashSecret(""))
  return userId !== undefined && owner === userId
}

/** Forgets this browser's device record, if it has one; returns the cookie that clears it. */
export function forgetThisDevice(hub: Hub, req: IncomingMessage): string {
  const secret = cookies(req).get(deviceCookieName(hub.config))
  if (secret !== undefined && SECRET_TEXT.test(secret)) hub.store.forgetDevice(hashSecret(secret))
  return setCookie(deviceCookieName(hub.config), "", { secure: hub.config.secure, maxAgeS: 0 })
}

/** After a successful sign-in: the device cookie to set, unless this device is already remembered for the user. */
export function rememberDevice(hub: Hub, req: IncomingMessage, userId: string): string | undefined {
  if (knownDevice(hub, req, userId)) return undefined
  const secret = newSecret()
  hub.store.addDevice(hashSecret(secret), userId, hub.config.now(), MAX_DEVICES)
  return setCookie(deviceCookieName(hub.config), secret, { secure: hub.config.secure, maxAgeS: DEVICE_S })
}

/** The signal a proxied exchange of the user listens to. */
export function cutSignal(hub: Hub, userId: string): AbortSignal {
  let controller = hub.userCuts.get(userId)
  if (!controller) {
    controller = new AbortController()
    hub.userCuts.set(userId, controller)
  }
  return controller.signal
}

export function epochOf(hub: Pick<Hub, "epochs">, userId: string): number {
  return hub.epochs.get(userId) ?? 0
}

/** Cuts the user's open proxied streams and stops their running workspaces, at once. */
export async function cutUser(hub: Pick<Hub, "userCuts" | "runner" | "epochs">, userId: string): Promise<void> {
  hub.epochs.set(userId, epochOf(hub, userId) + 1)
  hub.userCuts.get(userId)?.abort()
  hub.userCuts.delete(userId)
  await hub.runner.stopUser(userId)
}

/** Carries out the cuts the maintainer's commands asked for (the hub's 15-second sweep). */
export async function sweepCuts(hub: Hub): Promise<void> {
  for (const userId of hub.store.takeCuts()) await cutUser(hub, userId)
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
  // However much it is used, a session ends 30 days after sign-in.
  const lastPossible = session.created + MAX_SESSION_MS
  if (now >= lastPossible) {
    hub.store.endSession(sessionHash)
    return {}
  }
  const user = hub.store.userById(session.userId)
  if (!user) return {}
  const signed = { user, sessionHash, formToken: formTokenOf(secret) }
  if (now - session.lastSeen < RENEW_EVERY_MS) return { signed }
  const expires = Math.min(now + SESSION_MS, lastPossible)
  hub.store.renewSession(sessionHash, now, expires)
  return { signed, renewed: setCookie(sessionCookieName(hub.config), secret, { secure: hub.config.secure, maxAgeS: (expires - now) / 1000 }) }
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
