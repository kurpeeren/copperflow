// The agent's bearer tokens: personal access tokens (`cfp_`), OAuth access tokens (`cfa_`, one hour) and refresh tokens
// (`cfr_`, 30 days). Each is a prefix and 32 random bytes; only its SHA-256 is stored, and none is ever logged, put in
// a URL or in an error. A token is looked up by its hash; the store compares hashes in constant time.
import type { IncomingMessage } from "node:http"
import { hashSecret, newSecret } from "./secrets.js"

export const PAT_PREFIX = "cfp_"
export const ACCESS_PREFIX = "cfa_"
export const REFRESH_PREFIX = "cfr_"
export const MAX_PERSONAL_TOKENS = 10
export const ACCESS_MS = 60 * 60_000
export const REFRESH_MS = 30 * 24 * 60 * 60_000

const TOKEN_TEXT = /^cf[par]_[A-Za-z0-9_-]{43}$/

export function newToken(prefix: typeof PAT_PREFIX | typeof ACCESS_PREFIX | typeof REFRESH_PREFIX): string {
  return `${prefix}${newSecret()}`
}

/** The stored hash of a token of the right shape, else undefined (so nothing malformed reaches the store). */
export function tokenHash(token: string | undefined, prefix?: string): string | undefined {
  if (token === undefined || !TOKEN_TEXT.test(token) || (prefix !== undefined && !token.startsWith(prefix))) return undefined
  return hashSecret(token)
}

/** The bearer token of a request: exactly one Authorization header of the form `Bearer <token>`. */
export function bearerOf(req: IncomingMessage): { given: boolean; token?: string } {
  const raw = req.headers.authorization
  if (raw === undefined) return { given: false }
  const match = /^Bearer ([^\s]+)$/i.exec(raw)
  return match ? { given: true, token: match[1] as string } : { given: true }
}

/** A label typed by the person (a token's name): 1 to 100 characters without control characters. */
export function labelOf(text: string | undefined): string | undefined {
  const name = (text ?? "").trim().normalize("NFC")
  return name.length >= 1 && name.length <= 100 && !/[\u0000-\u001f\u007f-\u009f]/.test(name) ? name : undefined
}
