// What every hub route shares: the store, the project folders, the runner, the ticket key, the limits, and the
// session of the request (read from its cookie, renewed on use).
import type { IncomingMessage, ServerResponse } from "node:http"
import type { WorkspaceRunner } from "./runner/runner.js"
import type { SubnetSet } from "./peer-guard.js"
import type { AgentSessions } from "./agent-sessions.js"
import type { Catalog } from "./hub-catalog.js"
import type { OAuthState } from "./oauth-state.js"
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
  /** The proxy addresses X-Forwarded-For is honoured from; undefined when the hub is reached directly. */
  trustProxy: SubnetSet | undefined
  maxProjects: number
  maxBytes: number
  /** OAuth clients the hub keeps; default 10 000 (tests make it small). */
  maxClients: number
  /** New project-name certificates the hub may approve per week (--tls-ask-weekly); 0 approves none. */
  tlsAskWeekly: number
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
  enterTokens: Map<string, { userId: string; projectId: string; expires: number; epoch: number; hubSession: string }>
  /** Per user: the hashes of their live enter tokens, oldest first (at most 4; a fifth replaces the oldest). */
  enterByUser: Map<string, string[]>
  /** Per user: the event streams open through the proxy now (at most 8). */
  streamsOpen: Map<string, number>
  /** Transfers in progress: uploads in the whole hub, downloads per user. */
  transfers: { uploads: number; uploadingUsers: Set<string>; downloads: Map<string, number> }
  /** The agents' MCP sessions at the hub. */
  agents: AgentSessions
  /** The hub's MCP instructions and tool list, read once at start (hub-catalog.ts). */
  catalog: Catalog
  /** OAuth requests waiting for sign-in or consent, and issued codes (oauth.ts). */
  oauth: OAuthState
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
  /** Correct passwords (sign-in and current-password checks) per user id: 30 per 15 minutes; only a right password raises it. */
  correctPasswords: WindowCounter
  gate: SigninGate
  /** Tool calls per user: 60 a minute. */
  toolCalls: WindowCounter
  /** Routine audit rows per user and kind: 20 per 15 minutes. */
  routineRows: WindowCounter
  /** The one `audit-suppressed` row per user, kind and window, once the rows above are spent. */
  routineNotes: WindowCounter
  /** Requests to /mcp per user: 600 a minute. */
  mcpRequests: WindowCounter
  /** Refused bearer tokens audited per address: 10 per 15 minutes (the rest are refused unrecorded). */
  refusedTokens: WindowCounter
  /** OAuth client registrations per address: 20 an hour. */
  register: WindowCounter
  /** OAuth authorisation requests per address: 30 per 15 minutes. */
  authorize: WindowCounter
  /** Every registration passes this bucket: 2 a second, at most 2 waiting per address and 40 in all. */
  registerGate: SigninGate
  /** Every authorisation request passes this bucket: 5 a second, at most 2 waiting per address and 40 in all. */
  authorizeGate: SigninGate
}

const FIFTEEN_MINUTES = 15 * 60_000
/** Routine audit rows one user may write per kind in 15 minutes; then one `audit-suppressed` row and no more of that kind. */
export const ROUTINE_ROWS_PER_WINDOW = 20
/** Correct passwords one user may present (sign-in, current-password checks) in 15 minutes. */
export const CORRECT_PASSWORDS_PER_WINDOW = 30
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
    correctPasswords: new WindowCounter(CORRECT_PASSWORDS_PER_WINDOW, FIFTEEN_MINUTES, maxKeys),
    toolCalls: new WindowCounter(60, 60_000, maxKeys),
    routineRows: new WindowCounter(ROUTINE_ROWS_PER_WINDOW, FIFTEEN_MINUTES, maxKeys),
    routineNotes: new WindowCounter(1, FIFTEEN_MINUTES, maxKeys),
    mcpRequests: new WindowCounter(600, 60_000, maxKeys),
    refusedTokens: new WindowCounter(10, FIFTEEN_MINUTES, maxKeys),
    register: new WindowCounter(20, 60 * 60_000, maxKeys),
    authorize: new WindowCounter(30, FIFTEEN_MINUTES, maxKeys),
    // Only its bucket and fair queue are used (pass); its strict-mode counting is not.
    registerGate: new SigninGate({ threshold: Number.POSITIVE_INFINITY, windowMs: FIFTEEN_MINUTES, perSecond: 2, queue: 40, perAddress: 2 }),
    authorizeGate: new SigninGate({ threshold: Number.POSITIVE_INFINITY, windowMs: FIFTEEN_MINUTES, perSecond: 5, queue: 40, perAddress: 2 }),
    gate: new SigninGate({ threshold: MAX_FAILED_SIGNINS, windowMs: FIFTEEN_MINUTES, perSecond: 5, queue: 50, perAddress: 2 }),
  }
}

/**
 * The admission for one password check of user `userId`, asked inside the hashing slot right before the hash: counts
 * the attempt in the correct-password counter, or says no (`retryAfterS` is then set). A full table says no, never yes.
 * The caller takes the count back with `release` when the password turns out wrong, so only a right password stays counted.
 */
export function correctPasswordGate(hub: Hub, userId: string): { admit: () => boolean; release: () => void; retryAfterS: () => number } {
  let counted: number | undefined
  let retry = 60
  return {
    admit: () => {
      const now = hub.config.now()
      const check = hub.limits.correctPasswords.check(userId, now)
      if (!check.ok) {
        retry = check.retryAfterS
        return false
      }
      if (hub.limits.correctPasswords.add(userId, now) !== "ok") return false
      counted = now
      return true
    },
    release: () => {
      if (counted !== undefined) hub.limits.correctPasswords.refund(userId, counted)
      counted = undefined
    },
    retryAfterS: () => retry,
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
export async function passGate(hub: Hub, address: string, gone?: AbortSignal): Promise<boolean> {
  const now = hub.config.now()
  if (!hub.limits.gate.strict(now)) return true
  if (hub.limits.gate.announce(now)) audit(hub, address, null, "signin-strict")
  return hub.limits.gate.pass(addressKey(address), gone)
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

/**
 * Carries out the cuts the maintainer's commands asked for (the hub's 15-second sweep). The command revoked what the
 * database holds already; `revoke` (revocation.ts's revokeUser) does it all again here, with what only the running hub
 * holds: open agent sessions, streams, pending OAuth codes and workspaces.
 */
export async function sweepCuts(hub: Hub, revoke: (hub: Hub, userId: string) => Promise<void>): Promise<void> {
  for (const userId of hub.store.takeCuts()) await revoke(hub, userId)
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

/**
 * A routine audit row (kinds in ROUTINE_AUDIT_KINDS): at most ROUTINE_ROWS_PER_WINDOW per user and kind per 15 minutes,
 * then one `audit-suppressed` row naming the kind and no more of that kind until the window ends. A full limiter
 * table writes nothing. Security rows go through `audit` and are never suppressed.
 */
export function auditRoutine(hub: Hub, address: string, userId: string, event: "workspace-entered" | "tool-calls-limited", detail = ""): void {
  const now = hub.config.now()
  const key = `${userId}\u0000${event}`
  if (hub.limits.routineRows.check(key, now).ok) {
    if (hub.limits.routineRows.add(key, now) === "ok") audit(hub, address, userId, event, detail)
    return
  }
  if (hub.limits.routineNotes.check(key, now).ok && hub.limits.routineNotes.add(key, now) === "ok") audit(hub, address, userId, "audit-suppressed", event)
}

/** Adds the renewed session cookie, if any, to the headers of a response. */
export function withRenewed(renewed: string | undefined, headers: Record<string, string | string[]> = {}): Record<string, string | string[]> {
  return renewed ? { ...headers, "set-cookie": renewed } : headers
}

export type Handler = (hub: Hub, req: IncomingMessage, res: ServerResponse, address: string) => Promise<void>
