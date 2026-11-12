// Small HTTP helpers for the hub: bodies with a size limit, forms, cookies, the Origin check, fixed redirects and
// the headers every hub page carries.
import type { IncomingMessage, ServerResponse } from "node:http"

/** A request the hub answers with a status and a message meant for a person (never a stack or a path). */
export class HubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message)
  }
}

export const FORM_BODY_LIMIT = 1024 * 1024
const MAX_FORM_FIELDS = 32

export const PAGE_HEADERS: Record<string, string> = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  // form-action 'self' only: a page never posts to a project origin (and /p/<id>/ is a plain link).
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
}

/** The body, refused with 413 once it passes `limit` bytes. */
export async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"])
  if (Number.isFinite(declared) && declared > limit) throw new HubError(413, "The request is too large.")
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HubError(413, "The request is too large.")
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

/** An application/x-www-form-urlencoded body as single-valued fields. */
export async function readForm(req: IncomingMessage): Promise<Map<string, string>> {
  const type = (req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase()
  if (type !== "application/x-www-form-urlencoded") throw new HubError(415, "Send this form from the page.")
  const params = new URLSearchParams((await readBody(req, FORM_BODY_LIMIT)).toString("utf8"))
  const fields = new Map<string, string>()
  for (const [key, value] of params) {
    if (fields.has(key) || fields.size >= MAX_FORM_FIELDS) throw new HubError(400, "The form is not valid.")
    fields.set(key, value)
  }
  return fields
}

/**
 * The request's cookies by name. A name sent more than once maps to undefined: browsers send the cookie of the
 * narrowest path first, so a cookie planted for a sub-path would win any "first one" rule. Callers treat a duplicated
 * session cookie as no session at all.
 */
export function cookies(req: IncomingMessage): Map<string, string | undefined> {
  const found = new Map<string, string | undefined>()
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const at = part.indexOf("=")
    if (at < 1) continue
    const name = part.slice(0, at).trim()
    found.set(name, found.has(name) ? undefined : part.slice(at + 1).trim())
  }
  return found
}

export interface CookieOptions {
  secure: boolean
  maxAgeS: number
}

export function setCookie(name: string, value: string, options: CookieOptions): string {
  return `${name}=${value}; Path=/; Max-Age=${Math.max(0, Math.floor(options.maxAgeS))}; HttpOnly; SameSite=Lax${options.secure ? "; Secure" : ""}`
}

export function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * Whether a request comes from the hub's own pages: an Origin, when sent, must be the public origin; without one,
 * a browser's `Sec-Fetch-Site: cross-site` is refused.
 */
export function sameOrigin(req: IncomingMessage, publicOrigin: string): boolean {
  const origin = header(req, "origin")
  if (origin !== undefined) return origin === publicOrigin
  return header(req, "sec-fetch-site") !== "cross-site"
}

/** A 303 to a fixed local path; the path is always one the hub wrote, never one it was given. */
export function redirect(res: ServerResponse, path: "/" | "/projects" | "/account" | "/signin", headers: Record<string, string | string[]> = {}): void {
  res.writeHead(303, { location: path, "cache-control": "no-store", ...headers })
  res.end()
}

export function sendPage(res: ServerResponse, status: number, html: string, headers: Record<string, string | string[]> = {}): void {
  res.writeHead(status, { ...PAGE_HEADERS, ...headers })
  res.end(html)
}

/** The client's address: the socket's, or with `trustProxy` the last X-Forwarded-For entry (the one the proxy added). */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = header(req, "x-forwarded-for")
    const last = forwarded?.split(",").pop()?.trim()
    if (last && /^[0-9a-fA-F:.]{2,45}$/.test(last)) return last
  }
  return req.socket.remoteAddress ?? "unknown"
}
