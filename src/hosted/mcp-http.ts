// copperflow mcp --http: the same MCP server over the SDK's Streamable HTTP transport, one server and one session per
// client connection. Behind the hub every request needs the hub's workspace ticket.
import { randomUUID } from "node:crypto"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { nowSeconds, TICKET_HEADER, verifyTicket } from "./ticket.js"

export interface McpHttpOptions {
  /** 0 picks a free port. */
  port: number
  /** Defaults to 127.0.0.1. */
  bind?: string
  /** A new server for each session. */
  makeServer: () => McpServer
  /** Requires a valid ticket for this workspace on every request. */
  ticket?: { key: Buffer; workspaceId: string }
  /** Sessions open at once; default 16. */
  maxSessions?: number
}

export interface McpHttp {
  url: string
  close(): Promise<void>
}

const PATH = "/mcp"
const MAX_BODY_BYTES = 4 * 1024 * 1024
const DEFAULT_MAX_SESSIONS = 16

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
    if (size > MAX_BODY_BYTES) throw new Error("Request body is too large")
    chunks.push(chunk as Buffer)
  }
  const text = Buffer.concat(chunks).toString("utf8")
  return text === "" ? undefined : JSON.parse(text)
}

/** Starts the HTTP MCP server; the sessions end when it closes. */
export async function startMcpHttp(options: McpHttpOptions): Promise<McpHttp> {
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>()
  const maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (options.ticket) {
      const check = verifyTicket(req.headers[TICKET_HEADER], options.ticket.key, nowSeconds(), options.ticket.workspaceId)
      if (!check.ok) return refuse(res, 403, check.reason)
    }
    const path = (req.url ?? "/").split("?")[0]
    if (path !== PATH) return refuse(res, 404, "Not found")
    const sessionId = req.headers["mcp-session-id"]
    const body = req.method === "POST" ? await readBody(req) : undefined
    if (typeof sessionId === "string") {
      const session = sessions.get(sessionId)
      if (!session) return refuse(res, 404, "Unknown session")
      return session.transport.handleRequest(req, res, body)
    }
    if (req.method !== "POST" || !isInitializeRequest(body)) return refuse(res, 400, "Start a session with an initialize request")
    if (sessions.size >= maxSessions) return refuse(res, 429, "Too many open sessions")
    const server = options.makeServer()
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => void sessions.set(id, { transport, server }),
    })
    transport.onclose = () => {
      if (transport.sessionId !== undefined) sessions.delete(transport.sessionId)
      void server.close()
    }
    await server.connect(transport)
    await transport.handleRequest(req, res, body)
  }

  const http = createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      // Never the ticket or the key: only what the request got wrong.
      const message = error instanceof SyntaxError ? "Invalid JSON" : error instanceof Error && error.message === "Request body is too large" ? error.message : "Internal error"
      if (message === "Internal error") console.error("copperflow mcp:", error instanceof Error ? error.message : error)
      refuse(res, message === "Internal error" ? 500 : 400, message)
    })
  })
  const bind = options.bind ?? "127.0.0.1"
  await new Promise<void>((done, fail) => {
    http.once("error", fail)
    http.listen(options.port, bind, () => done())
  })
  const address = http.address()
  const port = typeof address === "object" && address ? address.port : options.port
  return {
    url: `http://${bind.includes(":") ? `[${bind}]` : bind}:${port}${PATH}`,
    close: async () => {
      for (const { transport } of [...sessions.values()]) await transport.close()
      http.closeAllConnections()
      await new Promise<void>((done) => http.close(() => done()))
    },
  }
}
