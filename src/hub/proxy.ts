// Forwards one request to a workspace's Studio, as docs/hosted.md's "What the hub must do" says: the browser's
// ticket and forwarded-host headers are dropped, the hub's own ticket is set, Host is the public host, and the
// response streams back unbuffered (server-sent events included) until either side goes away.
import { request, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from "node:http"
import { Transform } from "node:stream"
import { TICKET_HEADER } from "../hosted/ticket.js"

/** Request headers never forwarded: hop-by-hop ones, anything that could pass for the hub's word, and its cookie. */
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

/** Response headers never passed back: hop-by-hop ones, and cookies (a workspace never sets one on the hub's site). */
const DROPPED_RESPONSE = new Set(["connection", "keep-alive", "proxy-connection", "transfer-encoding", "trailer", "upgrade", "set-cookie", "set-cookie2"])

export interface ProxyTarget {
  /** The workspace's private origin, such as http://127.0.0.1:41234. */
  origin: string
  /** The path and query to send, exactly as the browser sent them. */
  path: string
  /** The public host, sent as Host. */
  publicHost: string
  ticket: string
  /** The most request body bytes forwarded. */
  maxBodyBytes: number
}

function forwardedHeaders(incoming: IncomingHttpHeaders, target: ProxyTarget): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || DROPPED_REQUEST.has(name) || name.startsWith("x-forwarded-") || name.startsWith("x-copperflow-")) continue
    headers[name] = value
  }
  headers.host = target.publicHost
  headers[TICKET_HEADER] = target.ticket
  return headers
}

function body(res: ServerResponse, status: number, text: string): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" })
  res.end(text)
}

/** Proxies the request; resolves when the exchange is over, for whatever reason. */
export function proxyRequest(req: IncomingMessage, res: ServerResponse, target: ProxyTarget): Promise<void> {
  return new Promise((done) => {
    const url = new URL(target.origin)
    let finished = false
    const finish = () => {
      if (finished) return
      finished = true
      done()
    }
    const upstream = request(
      { host: url.hostname, port: url.port, method: req.method, path: target.path, headers: forwardedHeaders(req.headers, target) },
      (answer) => {
        const headers: Record<string, string | string[]> = {}
        for (const [name, value] of Object.entries(answer.headers)) {
          if (value !== undefined && !DROPPED_RESPONSE.has(name)) headers[name] = value
        }
        res.writeHead(answer.statusCode ?? 502, headers)
        // Event streams must reach the browser as they are written.
        if (String(answer.headers["content-type"] ?? "").startsWith("text/event-stream")) res.flushHeaders()
        answer.pipe(res)
        answer.on("end", finish)
        answer.on("error", () => {
          res.destroy()
          finish()
        })
      },
    )
    upstream.on("error", () => {
      body(res, 502, "The workspace did not answer. Try again in a moment.")
      finish()
    })
    // The browser went away: end the exchange with the workspace too (this is what ends a proxied event stream).
    res.on("close", () => {
      upstream.destroy()
      finish()
    })
    let size = 0
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, next) {
        size += chunk.length
        if (size > target.maxBodyBytes) {
          upstream.destroy()
          body(res, 413, "The request is too large.")
          finish()
          return next()
        }
        next(null, chunk)
      },
    })
    req.pipe(limit).pipe(upstream)
  })
}
