// Passwords, session ids and invite codes. Passwords are scrypt hashes with a per-user salt and the parameters stored
// beside them; session ids and invite codes are 32 random bytes, kept only as SHA-256 hashes; every comparison of a
// secret is constant-time.
import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto"

export const MIN_PASSWORD_LENGTH = 10
/** Longer passwords are refused so that hashing cannot be used to load the server. */
export const MAX_PASSWORD_LENGTH = 1024

const SCRYPT = { N: 2 ** 15, r: 8, p: 1 }
const KEY_BYTES = 32
const SALT_BYTES = 16
const SECRET_BYTES = 32
/** The largest parameters a stored hash may ask for, so a damaged row cannot make one check take minutes. */
const MAX_N = 2 ** 20
const MAX_R = 16
const MAX_P = 4

/** Password hashes (scrypt, any route) that run at once in the hub. */
export const MAX_CONCURRENT_HASHES = 2
/**
 * Who a hash is for. "anonymous": a person with no account (sign-up, a sign-in for an email that has none); it may hold
 * at most ONE slot at a time and has its own waiting line of at most 16. "account": everything else (sign-in of an
 * existing account, current-password checks, a new password) waits in one line of at most 64. A request that finds its
 * line full is refused at once with HashBusyError (503, Retry-After 2).
 */
export type HashClass = "anonymous" | "account"
export const ANONYMOUS_HASH_SLOTS = 1
export const HASH_LINE_LIMIT: Readonly<Record<HashClass, number>> = { anonymous: 16, account: 64 }

export class HashBusyError extends Error {
  readonly retryAfterS = 2
  constructor() {
    super("The service is busy checking passwords. Try again in a moment.")
  }
}

interface Waiter {
  seq: number
  go: () => void
}
let hashesRunning = 0
let anonymousRunning = 0
let hashesPeak = 0
let hashesStarted = 0
let arrivals = 0
const lines: Record<HashClass, Waiter[]> = { anonymous: [], account: [] }

/** What the shared hashing slots are doing (for tests): running now, the most at once, started in all, waiting per line. */
export function hashLoad(): { running: number; peak: number; started: number; waiting: number; waitingAnonymous: number; waitingAccount: number } {
  return {
    running: hashesRunning,
    peak: hashesPeak,
    started: hashesStarted,
    waiting: lines.anonymous.length + lines.account.length,
    waitingAnonymous: lines.anonymous.length,
    waitingAccount: lines.account.length,
  }
}

export function resetHashPeak(): void {
  hashesPeak = hashesRunning
}

/** Starts waiting hashes while a slot is free: the one that waited longest, an anonymous one only below its slot limit. */
function dispatch(): void {
  while (hashesRunning < MAX_CONCURRENT_HASHES) {
    const account = lines.account[0]
    const anonymous = anonymousRunning < ANONYMOUS_HASH_SLOTS ? lines.anonymous[0] : undefined
    const next = account && anonymous ? (account.seq < anonymous.seq ? account : anonymous) : (account ?? anonymous)
    if (!next) return
    const kind: HashClass = next === account ? "account" : "anonymous"
    lines[kind].shift()
    hashesRunning += 1
    if (kind === "anonymous") anonymousRunning += 1
    hashesPeak = Math.max(hashesPeak, hashesRunning)
    next.go()
  }
}

/** Runs `work` in a hashing slot; later callers wait in arrival order in their class's line; a full line refuses at once. */
async function inHashSlot<T>(kind: HashClass, work: () => Promise<T>): Promise<T> {
  const line = lines[kind]
  let go!: () => void
  const started = new Promise<void>((done) => (go = done))
  const waiter: Waiter = { seq: (arrivals += 1), go }
  line.push(waiter)
  dispatch()
  const place = line.indexOf(waiter)
  if (place >= HASH_LINE_LIMIT[kind]) {
    line.splice(place, 1)
    throw new HashBusyError()
  }
  await started
  try {
    return await work()
  } finally {
    hashesRunning -= 1
    if (kind === "anonymous") anonymousRunning -= 1
    dispatch()
  }
}

function derive(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r + 1024 * 1024 }
  hashesStarted += 1
  return new Promise((done, fail) => scrypt(password.normalize("NFC"), salt, KEY_BYTES, options, (error, key) => (error ? fail(error) : done(key))))
}

/** A password hash: `scrypt$N$r$p$salt$key`, salt and key in base64. */
export async function hashPassword(password: string, kind: HashClass = "account"): Promise<string> {
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error("Password too long")
  const salt = randomBytes(SALT_BYTES)
  const key = await inHashSlot(kind, () => derive(password, salt, SCRYPT))
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), key.toString("base64")].join("$")
}

/** Whether the password matches the stored hash; a malformed hash never matches. */
export async function verifyPassword(password: string, stored: string, kind: HashClass = "account"): Promise<boolean> {
  return inHashSlot(kind, () => check(password, stored))
}

/**
 * Like verifyPassword, but `admit` is asked inside the slot, immediately before the hash would start, and a false
 * answer means no hash runs and "refused" comes back (the correct-password limit, docs/hosted.md).
 */
export async function verifyPasswordAdmitted(password: string, stored: string, admit: () => boolean): Promise<boolean | "refused"> {
  return inHashSlot<boolean | "refused">("account", () => (admit() ? check(password, stored) : Promise.resolve("refused")))
}

async function check(password: string, stored: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH) return false
  const [kind, n, r, p, salt, key] = stored.split("$")
  const params = { N: Number(n), r: Number(r), p: Number(p) }
  const sane = kind === "scrypt" && Number.isInteger(params.N) && params.N > 1 && params.N <= MAX_N && (params.N & (params.N - 1)) === 0
    && Number.isInteger(params.r) && params.r >= 1 && params.r <= MAX_R && Number.isInteger(params.p) && params.p >= 1 && params.p <= MAX_P
  if (!sane || salt === undefined || key === undefined) return false
  const expected = Buffer.from(key, "base64")
  if (expected.length !== KEY_BYTES) return false
  const given = await derive(password, Buffer.from(salt, "base64"), params)
  return timingSafeEqual(given, expected)
}

let dummyHash: Promise<string> | undefined
/** Spends the same time as checking a real password, so an unknown email answers no faster than a wrong password. */
export async function verifyAgainstNothing(password: string): Promise<false> {
  // A refused (busy) first hash is forgotten, so the next call makes it again.
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"), "anonymous").catch((error: unknown) => {
    dummyHash = undefined
    throw error
  })
  await verifyPassword(password, await dummyHash, "anonymous")
  return false
}

/** A new secret (session id, invite code, one-time password) as URL-safe text. */
export function newSecret(): string {
  return randomBytes(SECRET_BYTES).toString("base64url")
}

/** The SHA-256 of a secret, as stored. */
export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex")
}

/** Constant-time equality of two strings (different lengths are simply unequal). */
export function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8")
  const right = Buffer.from(b, "utf8")
  return left.length === right.length && timingSafeEqual(left, right)
}

/** The form token of a session: derived from its id, so knowing it reveals nothing about the id. */
export function formTokenOf(sessionSecret: string): string {
  return createHash("sha256").update("copperflow form token\0", "utf8").update(sessionSecret, "utf8").digest("base64url")
}

/** A generated id: 16 random bytes as lower-case hex (safe in paths, URLs and workspace ids). */
export function newId(): string {
  return randomBytes(16).toString("hex")
}

export const ID_PATTERN = /^[0-9a-f]{32}$/
