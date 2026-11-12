import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * A workspace ticket: the short-lived value the hub adds to every request it proxies to a workspace, as
 * `base64url(payload).base64url(hmac-sha256(payload))`. The workspace trusts nothing else in hosted mode.
 */
export interface TicketPayload {
  /** The workspace the ticket opens. */
  w: string
  /** The user the hub signed it for. */
  u: string
  /** When it stops working, in seconds since the epoch. */
  exp: number
}

/** The header the hub sends the ticket in. */
export const TICKET_HEADER = "x-copperflow-ticket"
/** The environment variable that holds the signing key. */
export const TICKET_KEY_ENV = "COPPERFLOW_TICKET_KEY"
const MIN_KEY_BYTES = 32
const MAX_TICKET_LENGTH = 4096

export type TicketCheck = { ok: true; payload: TicketPayload } | { ok: false; reason: string }

/** The signing key from the environment; refuses a missing or short one without ever repeating it. */
export function ticketKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer {
  const value = env[TICKET_KEY_ENV]
  if (value === undefined || value === "") throw new Error(`${TICKET_KEY_ENV} is not set`)
  const key = Buffer.from(value, "utf8")
  if (key.length < MIN_KEY_BYTES) throw new Error(`${TICKET_KEY_ENV} must be at least ${MIN_KEY_BYTES} bytes`)
  return key
}

function checkKey(key: Buffer): void {
  if (key.length < MIN_KEY_BYTES) throw new Error(`The ticket key must be at least ${MIN_KEY_BYTES} bytes`)
}

function mac(body: string, key: Buffer): Buffer {
  return createHmac("sha256", key).update(body).digest()
}

/** Signs a payload into a ticket. */
export function signTicket(payload: TicketPayload, key: Buffer): string {
  checkKey(key)
  const body = Buffer.from(JSON.stringify({ w: payload.w, u: payload.u, exp: payload.exp }), "utf8").toString("base64url")
  return `${body}.${mac(body, key).toString("base64url")}`
}

function isPayload(value: unknown): value is TicketPayload {
  if (typeof value !== "object" || value === null) return false
  const { w, u, exp } = value as Record<string, unknown>
  return typeof w === "string" && w !== "" && typeof u === "string" && u !== "" && typeof exp === "number" && Number.isFinite(exp)
}

/**
 * Checks a ticket: its signature (constant time), its expiry against `now` (seconds since the epoch) and, when
 * `workspace` is given, that it opens this workspace. The reasons name what is wrong, never the key or the signature.
 */
export function verifyTicket(text: unknown, key: Buffer, now: number, workspace?: string): TicketCheck {
  checkKey(key)
  if (typeof text !== "string" || text === "") return { ok: false, reason: "Missing workspace ticket" }
  if (text.length > MAX_TICKET_LENGTH) return { ok: false, reason: "Malformed workspace ticket" }
  const parts = text.split(".")
  if (parts.length !== 2 || !/^[\w-]+$/.test(parts[0] ?? "") || !/^[\w-]+$/.test(parts[1] ?? "")) {
    return { ok: false, reason: "Malformed workspace ticket" }
  }
  const [body, signature] = parts as [string, string]
  const given = Buffer.from(signature, "base64url")
  const expected = mac(body, key)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "Invalid workspace ticket" }
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  } catch {
    return { ok: false, reason: "Malformed workspace ticket" }
  }
  if (!isPayload(payload)) return { ok: false, reason: "Malformed workspace ticket" }
  if (payload.exp <= now) return { ok: false, reason: "Expired workspace ticket" }
  if (workspace !== undefined && payload.w !== workspace) return { ok: false, reason: "The ticket is for another workspace" }
  return { ok: true, payload: { w: payload.w, u: payload.u, exp: payload.exp } }
}

/** Seconds since the epoch. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
