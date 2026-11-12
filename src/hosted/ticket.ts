import { createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto"

/**
 * A workspace ticket: the short-lived value the hub adds to every request it proxies to a workspace, as
 * `base64url(payload).base64url(ed25519 signature)`. The hub holds the private key; a workspace holds only the public
 * key, so nothing that runs in a workspace can make a ticket.
 */
export interface TicketPayload {
  /** The workspace the ticket opens. */
  w: string
  /** The user the hub signed it for. */
  u: string
  /** When it was signed, in seconds since the epoch. */
  iat: number
  /** When it stops working, in seconds since the epoch. */
  exp: number
}

/** The header the hub sends the ticket in. */
export const TICKET_HEADER = "x-copperflow-ticket"
/** The environment variable that holds the public key: base64 of the raw 32-byte key, or PEM. */
export const TICKET_PUBLIC_KEY_ENV = "COPPERFLOW_TICKET_PUBLIC_KEY"
/** The longest a ticket may live; the hub signs much shorter ones. */
export const MAX_TICKET_LIFETIME_S = 15 * 60
/** How far in the future a ticket's issue time may be (clock skew). */
export const MAX_SKEW_S = 30
const MAX_TICKET_LENGTH = 4096
const RAW_KEY_BYTES = 32
const SIGNATURE_BYTES = 64
/** The DER prefix of an Ed25519 SubjectPublicKeyInfo; the raw 32-byte key follows it. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")
const BAD_KEY = "The ticket public key must be an Ed25519 key: PEM, or base64 of its 32 raw bytes"

export type TicketCheck = { ok: true; payload: TicketPayload } | { ok: false; reason: string }

/** A new Ed25519 key pair, for the hub (and tests). */
export function generateTicketKeys(): { privateKey: KeyObject; publicKey: KeyObject; publicKeyBase64: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519")
  return { privateKey, publicKey, publicKeyBase64: publicKey.export({ format: "der", type: "spki" }).subarray(SPKI_PREFIX.length).toString("base64") }
}

/** The public key from text: PEM, or base64 of the raw 32 bytes. The error never repeats the text. */
export function ticketPublicKey(text: string): KeyObject {
  const trimmed = text.trim()
  let key: KeyObject
  try {
    // A private key is refused outright: it must never sit in a workspace, even though a public key derives from it.
    if (trimmed.includes("PRIVATE KEY")) throw new Error(BAD_KEY)
    if (trimmed.startsWith("-----BEGIN")) key = createPublicKey(trimmed)
    else {
      const raw = Buffer.from(trimmed, "base64")
      if (raw.length !== RAW_KEY_BYTES) throw new Error(BAD_KEY)
      key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" })
    }
  } catch {
    throw new Error(BAD_KEY)
  }
  if (key.type !== "public" || key.asymmetricKeyType !== "ed25519") throw new Error(BAD_KEY)
  return key
}

/** The public key from the environment. */
export function ticketPublicKeyFromEnv(env: NodeJS.ProcessEnv = process.env): KeyObject {
  const value = env[TICKET_PUBLIC_KEY_ENV]
  if (value === undefined || value === "") throw new Error(`${TICKET_PUBLIC_KEY_ENV} is not set`)
  return ticketPublicKey(value)
}

function requireKind(key: KeyObject, type: "private" | "public"): void {
  if (key.type !== type || key.asymmetricKeyType !== "ed25519") throw new Error(`Tickets need an Ed25519 ${type} key`)
}

/** Signs a payload into a ticket (the hub's side). */
export function signTicket(payload: TicketPayload, privateKey: KeyObject): string {
  requireKind(privateKey, "private")
  const body = Buffer.from(JSON.stringify({ w: payload.w, u: payload.u, iat: payload.iat, exp: payload.exp }), "utf8").toString("base64url")
  return `${body}.${sign(null, Buffer.from(body), privateKey).toString("base64url")}`
}

function isPayload(value: unknown): value is TicketPayload {
  if (typeof value !== "object" || value === null) return false
  const { w, u, iat, exp } = value as Record<string, unknown>
  const time = (n: unknown) => typeof n === "number" && Number.isFinite(n)
  return typeof w === "string" && w !== "" && typeof u === "string" && u !== "" && time(iat) && time(exp)
}

/**
 * Checks a ticket: its signature, its issue time (at most `MAX_SKEW_S` ahead of `now`), its lifetime (at most
 * `MAX_TICKET_LIFETIME_S`), its expiry and that it opens `workspaceId`. The reasons never name the key.
 */
export function verifyTicket(text: unknown, publicKey: KeyObject, now: number, workspaceId: string): TicketCheck {
  requireKind(publicKey, "public")
  if (workspaceId === "") throw new Error("verifyTicket needs the workspace id")
  if (typeof text !== "string" || text === "") return { ok: false, reason: "Missing workspace ticket" }
  const malformed = { ok: false as const, reason: "Malformed workspace ticket" }
  if (text.length > MAX_TICKET_LENGTH) return malformed
  const parts = text.split(".")
  if (parts.length !== 2 || !/^[\w-]+$/.test(parts[0] ?? "") || !/^[\w-]+$/.test(parts[1] ?? "")) return malformed
  const [body, signature] = parts as [string, string]
  const given = Buffer.from(signature, "base64url")
  if (given.length !== SIGNATURE_BYTES || !verify(null, Buffer.from(body), publicKey, given)) return { ok: false, reason: "Invalid workspace ticket" }
  let payload: unknown
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
  } catch {
    return malformed
  }
  if (!isPayload(payload)) return malformed
  if (payload.iat > now + MAX_SKEW_S) return { ok: false, reason: "Workspace ticket issued in the future" }
  if (payload.exp - payload.iat > MAX_TICKET_LIFETIME_S) return { ok: false, reason: "Workspace ticket lives too long" }
  if (payload.exp <= now) return { ok: false, reason: "Expired workspace ticket" }
  if (payload.w !== workspaceId) return { ok: false, reason: "The ticket is for another workspace" }
  return { ok: true, payload: { w: payload.w, u: payload.u, iat: payload.iat, exp: payload.exp } }
}

/** Seconds since the epoch. */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
