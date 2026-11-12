// Forwards one request to a workspace's Studio, as docs/hosted.md's "What the hub must do" says: the browser's
// ticket and forwarded-host headers are dropped, the hub's own ticket is set, Host is the project origin's host, and
// the response streams back unbuffered (server-sent events included) until either side goes away. Only an allow-list
// of response headers comes back, so a workspace cannot set cookies, clear site data, redirect elsewhere or open CORS.
import { request, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { TICKET_HEADER } from "../hosted/ticket.js"

/** Request headers never forwarded: hop-by-hop ones, anything that could pass for the hub's word, and cookies. */
const DROPPED_REQUEST = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authorization",
  "proxy-authenticate",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "cookie",
  "authorization",
  "forwarded",
  "x-real-ip",
  TICKET_HEADER,
])

/** The response headers a workspace may send back. */
const ALLOWED_RESPONSE = new Set(["content-type", "content-length", "content-encoding", "cache-control", "etag", "last-modified", "content-disposition", "vary"])

/** The longest a non-stream answer may take, and the most bytes it may have. */
export const UPSTREAM_TIMEOUT_MS = 60_000
export const MAX_RESPONSE_BYTES = 64 * 1024 * 1024

export interface ProxyTarget {
  /** The workspace's private origin, such as http://127.0.0.1:41234. */
  origin: string
  /** The path and query to send, exactly as the browser sent them. */
  path: string
  /** The host sent as Host (the project origin's). */
  publicHost: string
  /** The project origin: a Location is passed back only when it is a path on it. */
  projectOrigin: string
  /** The only origin that may frame the answer. */
  frameAncestor: string
  /** Signs the ticket at the last moment; undefined means the session no longer holds and nothing is sent. */
  ticket: () => string | undefined
  /** The most request body bytes forwarded. */
  maxBodyBytes: number
  /** The longest any exchange (an event stream included) may last; then both sides are cut. */
  maxDurationMs: number
  /** Aborting it cuts the exchange at once (sign-out, password change, deletion). */
  signal?: AbortSignal
}

function forwardedHeaders(incoming: IncomingHttpHeaders, host: string, ticket: string): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || DROPPED_REQUEST.has(name) || name.startsWith("x-forwarded-") || name.startsWith("x-copperflow-")) continue
    headers[name] = value
  }
  headers.host = host
  headers[TICKET_HEADER] = ticket
  return headers
}

/** The answer's headers after the allow-list, with nosniff, the frame rule and a same-origin Location only. */
export function answerHeaders(incoming: IncomingHttpHeaders, target: Pick<ProxyTarget, "projectOrigin" | "frameAncestor">): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(incoming)) if (value !== undefined && ALLOWED_RESPONSE.has(name)) headers[name] = value
  const location = incoming.location
  if (typeof location === "string") {
    try {
      const url = new URL(location, target.projectOrigin)
      if (url.origin === target.projectOrigin && location.startsWith("/") && !location.startsWith("//")) headers.location = location
    } catch {
      // Not a URL: dropped.
    }
  }
  headers["x-content-type-options"] = "nosniff"
  headers["content-security-policy"] = `frame-ancestors ${target.frameAncestor}`
  return headers
}

function plain(res: ServerResponse, status: number, text: string): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" })
  res.end(text)
}

/** Fails the chain once more than `limit` bytes have passed. */
function limitTo(limit: number, onOver: () => void): Transform {
  let size = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, next) {
      size += chunk.length
      if (size > limit) {
        onOver()
        return next(new Error("too large"))
      }
      next(null, chunk)
    },
  })
}

/** Proxies the request; resolves when the exchange is over, for whatever reason. Errors never escape. */
export async function proxyRequest(req: IncomingMessage, res: ServerResponse, target: ProxyTarget): Promise<void> {
  const ticket = target.ticket()
  if (ticket === undefined) return plain(res, 404, "There is no such page.")
  const url = new URL(target.origin)
  const controller = new AbortController()
  const cut = () => controller.abort()
  target.signal?.addEventListener("abort", cut)
  if (target.signal?.aborted) cut()
  const timer = setTimeout(cut, target.maxDurationMs)
  timer.unref()
  res.on("close", cut)
  try {
    const upstream = request({ host: url.hostname, port: url.port, method: req.method, path: target.path, headers: forwardedHeaders(req.headers, target.publicHost, ticket), signal: controller.signal })
    const answered = new Promise<IncomingMessage>((done, fail) => {
      upstream.once("response", done)
      upstream.once("error", fail)
    })
    // Request body: client → size limit → workspace. Any failure rejects and destroys every stage.
    const sending = pipeline(req, limitTo(target.maxBodyBytes, () => plain(res, 413, "The request is too large.")), upstream).catch(() => cut())
    const answer = await answered
    const stream = String(answer.headers["content-type"] ?? "").startsWith("text/event-stream")
    // A non-stream answer must arrive within its own time limit.
    const slow = stream ? undefined : setTimeout(cut, UPSTREAM_TIMEOUT_MS)
    slow?.unref()
    res.writeHead(answer.statusCode ?? 502, answerHeaders(answer.headers, target))
    if (stream) res.flushHeaders()
    try {
      await pipeline(answer, limitTo(stream ? Number.POSITIVE_INFINITY : MAX_RESPONSE_BYTES, () => undefined), res)
    } finally {
      clearTimeout(slow)
    }
    await sending
  } catch {
    if (res.writableEnded) return
    if (!res.headersSent && !controller.signal.aborted) plain(res, 502, "The workspace did not answer. Try again in a moment.")
    else res.destroy()
  } finally {
    clearTimeout(timer)
    target.signal?.removeEventListener("abort", cut)
    res.off("close", cut)
  }
}
