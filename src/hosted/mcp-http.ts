// copperflow mcp --http: the same MCP server over the SDK's Streamable HTTP transport, one server and one session per
// client. Behind the hub every request needs the hub's workspace ticket, and a session belongs to the user whose
// ticket opened it.
import type { KeyObject } from "node:crypto"
import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { DEFAULT_MAX_STREAM_MS, normaliseOrigin } from "./gate.js"
import { nowSeconds, TICKET_HEADER, verifyTicket, type TicketPayload } from "./ticket.js"
import { SessionRefusal, SessionTable, type Reservation } from "./mcp-sessions.js"

export interface McpHttpOptions {
  /** 0 picks a free port. */
  port: number
  /** Defaults to 127.0.0.1. Any address but a loopback one needs `ticket`. */
  bind?: string
  /** A new server for each session. */
  makeServer: () => McpServer
  /** Every request needs a valid ticket for this workspace, signed by the hub's key. */
  ticket?: { publicKey: KeyObject; workspaceId: string }
  /** The public origin behind the hub: the only Origin and Host accepted. Required with `ticket`. */
  publicOrigin?: string
  /** Serves without tickets; allowed only on a loopback address (tests and local use). */
  insecureLocal?: boolean
  /**
   * Sessions open at once on the whole server; default 16. At the limit the longest-idle session of a user above
   * their fair share is closed, or initialize is refused (429).
   */
  maxSessions?: number
  /** Sessions one user may hold; default 4. At the limit that user's session idle longest is closed. */
  maxSessionsPerUser?: number
  /** A session nobody used for this long is closed (never while a stream is open); default 10 minutes. */
  idleMs?: number
  /** Every session is closed this long after it opened, streams or not; default 60 minutes. */
  lifetimeMs?: number
  /** The longest a GET stream stays open; default 15 minutes. It also ends when its ticket expires. */
  maxStreamMs?: number
}

export interface McpHttp {
  url: string
  /** Sessions open now. */
  sessions(): number
  close(): Promise<void>
}

const PATH = "/mcp"
const MAX_BODY_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_SESSIONS = 16
const DEFAULT_MAX_SESSIONS_PER_USER = 4
const DEFAULT_IDLE_MS = 10 * 60_000
const DEFAULT_LIFETIME_MS = 60 * 60_000
const REQUEST_TIMEOUT_MS = 15_000
const HEADERS_TIMEOUT_MS = 10_000
const MAX_CONNECTIONS = 64

class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/** Whether an address is the machine's own (only there may MCP run without tickets). */
export function isLoopback(address: string): boolean {
  return address === "localhost" || address === "::1" || /^127(\.\d{1,3}){3}$/.test(address)
}

function refuse(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return void res.end()
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" })
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }))
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > MAX_BODY_BYTES) throw new Refusal(413, "Request body is too large")
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  if (text === "") return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new Refusal(400, "Invalid JSON")
  }
}

/** The public origin, after checking the server may start as asked. */
function checkStart(options: McpHttpOptions, bind: string): string | undefined {
  if (options.ticket) {
    if (options.publicOrigin === undefined) throw new Error("MCP over HTTP with tickets needs the public origin")
    return normaliseOrigin(options.publicOrigin)
  }
  if (!options.insecureLocal) throw new Error("MCP over HTTP needs the hub's ticket key (or insecureLocal for a loopback test server)")
  if (!isLoopback(bind)) throw new Error(`MCP over HTTP without tickets may only listen on a loopback address, not ${bind}`)
  return undefined
}

const hostOf = (address: string, port: number) => `${address.includes(":") ? `[${address}]` : address}:${port}`

/** Starts the HTTP MCP server; the sessions end when it closes. */
export async function startMcpHttp(options: McpHttpOptions): Promise<McpHttp> {
  const bind = options.bind ?? "127.0.0.1"
  const publicOrigin = checkStart(options, bind)
  const publicHost = publicOrigin === undefined ? undefined : new URL(publicOrigin).host
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS
  const maxStreamMs = options.maxStreamMs ?? DEFAULT_MAX_STREAM_MS
  let port = options.port

  const maxPerUser = options.maxSessionsPerUser ?? DEFAULT_MAX_SESSIONS_PER_USER

  const table = new SessionTable({ maxSessions, maxPerUser, idleMs, lifetimeMs: options.lifetimeMs ?? DEFAULT_LIFETIME_MS })
  const transports = new Map<string, StreamableHTTPServerTransport>()

  /** Checks the Origin, then (with tickets) the Host the hub forwards and the ticket; the ticket's payload, if any. */
  function admit(req: IncomingMessage): TicketPayload | undefined {
    if (req.headers.origin !== undefined && req.headers.origin !== publicOrigin) throw new Refusal(403, "Cross-origin requests are not allowed")
    if (!options.ticket) return undefined
    // The same header the SDK's allowed-hosts check reads: the hub forwards Host as the public host (docs/hosted.md).
    if (req.headers.host !== publicHost) throw new Refusal(403, "Unexpected Host header")
    const check = verifyTicket(req.headers[TICKET_HEADER], options.ticket.publicKey, nowSeconds(), options.ticket.workspaceId)
    if (!check.ok) throw new Refusal(403, check.reason)
    return check.payload
  }

  /** Ends a GET stream when its ticket expires or at the cap; the client opens a new one through the hub. */
  function limitStream(res: ServerResponse, ticket: TicketPayload | undefined): void {
    const endsAt = Math.min(ticket ? ticket.exp * 1000 : Number.POSITIVE_INFINITY, Date.now() + maxStreamMs)
    const timer = setTimeout(() => res.end(), Math.max(0, endsAt - Date.now()))
    res.on("close", () => clearTimeout(timer))
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const ticket = admit(req)
    if ((req.url ?? "/").split("?")[0] !== PATH) throw new Refusal(404, "Not found")
    const sessionId = req.headers["mcp-session-id"]
    const body = req.method === "POST" ? await readBody(req) : undefined
    if (typeof sessionId === "string") {
      const transport = transports.get(sessionId)
      const owner = table.userOf(sessionId)
      if (!transport || owner === undefined) throw new Refusal(404, "Unknown session")
      if (owner !== (ticket?.u ?? "")) throw new Refusal(403, "The session belongs to another user")
      if (req.method === "GET") {
        table.streamOpened(sessionId)
        limitStream(res, ticket)
        res.on("close", () => table.streamClosed(sessionId))
      } else table.touch(sessionId)
      return transport.handleRequest(req, res, body)
    }
    if (req.method !== "POST" || !isInitializeRequest(body)) throw new Refusal(400, "Start a session with an initialize request")
    return initialise(req, res, body, ticket?.u ?? "")
  }

  /** A new session: its slot is reserved before the first await and given back if it never registers. */
  async function initialise(req: IncomingMessage, res: ServerResponse, body: unknown, user: string): Promise<void> {
    let reservation: Reservation
    try {
      reservation = table.reserve(user)
    } catch (error) {
      if (error instanceof SessionRefusal) throw new Refusal(error.status, error.message)
      throw error
    }
    try {
      const server = options.makeServer()
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableDnsRebindingProtection: true,
        allowedHosts: publicHost ? [publicHost] : [hostOf(bind, port), `localhost:${port}`],
        onsessioninitialized: (id) => {
          transports.set(id, transport)
          reservation.commit(id, () => void transport.close())
        },
      })
      transport.onclose = () => {
        const id = transport.sessionId
        if (id !== undefined) {
          transports.delete(id)
          table.forget(id)
        }
        void server.close()
      }
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } finally {
      // Registered sessions committed already; this gives back only a slot that never became a session.
      reservation.release()
    }
  }

  const http = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      // Never the ticket or the key: only what the request got wrong.
      if (error instanceof Refusal) return refuse(res, error.status, error.message)
      console.error("copperflow mcp:", error instanceof Error ? error.message : "unknown error")
      refuse(res, 500, "Internal error")
    })
  })
  http.requestTimeout = REQUEST_TIMEOUT_MS
  http.headersTimeout = HEADERS_TIMEOUT_MS
  http.maxConnections = MAX_CONNECTIONS
  await new Promise<void>((done, fail) => {
    http.once("error", fail)
    http.listen(options.port, bind, () => done())
  })
  const address = http.address()
  port = typeof address === "object" && address ? address.port : options.port
  return {
    url: `http://${hostOf(bind, port)}${PATH}`,
    sessions: () => table.size,
    close: async () => {
      table.closeAll()
      http.closeAllConnections()
      await new Promise<void>((done) => http.close(() => done()))
    },
  }
}
