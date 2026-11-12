import type { KeyObject } from "node:crypto"
import type { IncomingHttpHeaders } from "node:http"
import { nowSeconds, TICKET_HEADER, verifyTicket, type TicketPayload } from "./ticket.js"

/** How a workspace's server runs behind the hub. */
export interface HostedOptions {
  /** The private address to listen on (the workspace's interface, never a public one). */
  bind: string
  /** The public origin the person's browser uses, such as https://copperflow.example.com. */
  publicOrigin: string
  /** The path the Studio is served under, such as /p/demo; "" serves at the root. */
  basePath: string
  /** The workspace this server serves; a ticket for any other is refused. */
  workspaceId: string
  /** The hub's Ed25519 public key: a workspace can check tickets, never make them. */
  ticketPublicKey: KeyObject
  /** The longest an event stream stays open, in ms; default 15 minutes. It also ends when its ticket expires. */
  maxStreamMs?: number
}

export const DEFAULT_MAX_STREAM_MS = 15 * 60_000

export type GateResult =
  | { kind: "pass"; url: URL; ticket?: TicketPayload }
  | { kind: "redirect"; location: string }
  | { kind: "refuse"; status: number; reason: string }

/** A base path in one form: "" or "/a/b", no trailing slash; refuses anything else. */
export function normaliseBasePath(basePath: string): string {
  const trimmed = basePath.replace(/\/+$/, "")
  if (trimmed !== "" && !/^(\/[\w.-]+)+$/.test(trimmed)) throw new Error(`Bad base path ${JSON.stringify(basePath)}`)
  if (trimmed.split("/").some((segment) => segment === "." || segment === "..")) throw new Error(`Bad base path ${JSON.stringify(basePath)}`)
  return trimmed
}

/** The public origin in one form (scheme, host and port, nothing else). */
export function normaliseOrigin(origin: string): string {
  const url = new URL(origin)
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The public origin must be http(s)")
  return url.origin
}

export function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** The Host a hosted request was sent to: the hub's x-forwarded-host when present, else Host. */
function publicHost(headers: IncomingHttpHeaders): string | undefined {
  const forwarded = header(headers, "x-forwarded-host")
  return forwarded !== undefined ? forwarded.split(",")[0]?.trim() : headers.host
}

/**
 * Decides a hosted request: the Host and Origin must be the public origin's, the path must lie under the base path,
 * and every API request needs a valid ticket for this workspace. `path` is the request's path with the base removed.
 */
export function gateHosted(method: string | undefined, rawUrl: string | undefined, headers: IncomingHttpHeaders, options: HostedOptions, now = nowSeconds()): GateResult {
  const origin = new URL(options.publicOrigin)
  if (publicHost(headers) !== origin.host) return { kind: "refuse", status: 403, reason: "Unexpected Host header" }
  const sentOrigin = headers.origin
  if (sentOrigin !== undefined && sentOrigin !== origin.origin) return { kind: "refuse", status: 403, reason: "Cross-origin requests are not allowed" }
  const raw = rawUrl ?? "/"
  const query = raw.indexOf("?")
  const rawPath = query < 0 ? raw : raw.slice(0, query)
  // Read the raw path once and refuse every shape two parsers could read differently.
  if (!isPlainPath(rawPath)) return { kind: "refuse", status: 400, reason: "Bad path" }
  const base = options.basePath
  if (base !== "" && rawPath === base && method === "GET") return { kind: "redirect", location: `${base}/` }
  if (base !== "" && !rawPath.startsWith(`${base}/`)) return { kind: "refuse", status: 404, reason: "Not found" }
  // The one URL both the ticket check and the router read: set field by field, never parsed from a joined string.
  const url = new URL("http://workspace.invalid/")
  url.pathname = rawPath.slice(base.length)
  url.search = query < 0 ? "" : raw.slice(query)
  if (url.pathname !== rawPath.slice(base.length)) return { kind: "refuse", status: 400, reason: "Bad path" }
  if (!url.pathname.startsWith("/api/")) return { kind: "pass", url }
  const check = verifyTicket(header(headers, TICKET_HEADER), options.ticketPublicKey, now, options.workspaceId)
  if (!check.ok) return { kind: "refuse", status: 403, reason: check.reason }
  return { kind: "pass", url, ticket: check.payload }
}

/** A path with no empty, "." or ".." segment, no backslash and no encoded slash or backslash. */
function isPlainPath(path: string): boolean {
  if (!path.startsWith("/") || path.includes("\\") || /%(2f|5c)/i.test(path)) return false
  const segments = path.slice(1).split("/")
  return segments.every((segment, index) => {
    if (segment === "") return index === segments.length - 1
    const decoded = /%2e/i.test(segment) ? segment.replace(/%2e/gi, ".") : segment
    return decoded !== "." && decoded !== ".."
  })
}
