import type { IncomingHttpHeaders } from "node:http"
import { nowSeconds, TICKET_HEADER, verifyTicket } from "./ticket.js"

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
  /** The key the hub signs tickets with (at least 32 bytes). */
  ticketKey: Buffer
}

export type GateResult =
  | { kind: "pass"; path: string }
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

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
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
  const pathname = new URL(rawUrl ?? "/", origin.origin).pathname
  const base = options.basePath
  if (base !== "" && pathname === base && method === "GET") return { kind: "redirect", location: `${base}/` }
  if (base !== "" && !pathname.startsWith(`${base}/`)) return { kind: "refuse", status: 404, reason: "Not found" }
  const path = pathname.slice(base.length)
  if (path.startsWith("/api/")) {
    const check = verifyTicket(header(headers, TICKET_HEADER), options.ticketKey, now, options.workspaceId)
    if (!check.ok) return { kind: "refuse", status: 403, reason: check.reason }
  }
  return { kind: "pass", path }
}
