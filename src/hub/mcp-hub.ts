// /mcp on the public origin: the MCP server the agent talks to (Streamable HTTP on node:http, as
// src/hosted/mcp-http.ts does it). Only `Authorization: Bearer <token>` authenticates it, never a cookie; a request
// without a valid token gets 401 with the protected resource's metadata address. A session belongs to the user and
// the credential (personal token or OAuth grant) that opened it.
import { randomUUID } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js"
import { CallToolRequestSchema, isInitializeRequest, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { SessionRefusal } from "../hosted/mcp-sessions.js"
import { VERSION } from "../version.js"
import { ACCESS_PREFIX, bearerOf, PAT_PREFIX, tokenHash } from "./agent-tokens.js"
import { audit, type Hub } from "./context.js"
import { HubError, readBody } from "./http.js"
import { addressKey } from "./limits.js"
import type { Credential } from "./token-store.js"
import { callTool, stillAuthorised, type AgentState, type CallAuth } from "./hub-tools.js"

export const MCP_BODY_LIMIT = 4 * 1024 * 1024
/** The longest a GET stream stays open; it also ends when its access token expires. */
const MAX_STREAM_MS = 15 * 60_000

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "mcp-session-id, mcp-protocol-version, www-authenticate",
}

function rpcError(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) return void res.end()
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...CORS, ...headers })
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }))
}

export function resourceMetadataUrl(hub: Hub): string {
  return `${hub.config.publicOrigin}/.well-known/oauth-protected-resource`
}

/** The credential of a bearer token that may open /mcp (a personal token or a live access token) and its hash. */
function authenticate(hub: Hub, req: IncomingMessage): { credential: Credential; hash: string } | undefined {
  const { token } = bearerOf(req)
  const hash = tokenHash(token, PAT_PREFIX) ?? tokenHash(token, ACCESS_PREFIX)
  if (hash === undefined) return undefined
  const credential = hub.store.tokens.credential(hash, hub.config.now())
  if (!credential) return undefined
  const user = hub.store.userById(credential.userId)
  if (!user || user.mustChangePassword) return undefined
  return { credential, hash }
}

/** 401 with the metadata address; a refused token is audited (never the token), at most 10 times per 15 minutes per address. */
function unauthorised(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string): void {
  if (bearerOf(req).given) {
    const now = hub.config.now()
    const key = addressKey(address)
    if (hub.limits.refusedTokens.check(key, now).ok) {
      hub.limits.refusedTokens.add(key, now)
      audit(hub, address, null, "token-refused")
    }
  }
  rpcError(res, 401, "A valid bearer token is required.", { "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl(hub)}"` })
}

export async function serveMcp(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string): Promise<void> {
  try {
    await handle(hub, req, res, address)
  } catch (error) {
    if (error instanceof HubError) return rpcError(res, error.status, error.message)
    if (error instanceof SessionRefusal) return rpcError(res, error.status, error.message)
    hub.log(`mcp request failed: ${(error as Error)?.message ?? "unknown error"}`)
    rpcError(res, 500, "Internal error")
  }
}

async function handle(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string): Promise<void> {
  const method = req.method ?? "GET"
  if (method === "OPTIONS") {
    res.writeHead(204, { ...CORS, "access-control-allow-methods": "POST, GET, DELETE", "access-control-allow-headers": "authorization, content-type, mcp-session-id, mcp-protocol-version, last-event-id", "access-control-max-age": "600" })
    return void res.end()
  }
  if (method !== "POST" && method !== "GET" && method !== "DELETE") return rpcError(res, 405, "Method not allowed")
  // Node keeps only the first Authorization header; more than one is refused rather than guessed at.
  if (req.rawHeaders.filter((name, index) => index % 2 === 0 && name.toLowerCase() === "authorization").length > 1) return rpcError(res, 400, "Send one Authorization header.")
  if (!authenticate(hub, req)) return unauthorised(hub, req, res, address)
  const raw = method === "POST" ? await readBody(req, MCP_BODY_LIMIT) : undefined
  // Checked again after the body arrived: the token may have been revoked meanwhile.
  const auth = authenticate(hub, req)
  if (!auth) return unauthorised(hub, req, res, address)
  let body: unknown
  if (raw !== undefined && raw.length > 0) {
    try {
      body = JSON.parse(raw.toString("utf8"))
    } catch {
      return rpcError(res, 400, "Invalid JSON")
    }
  }
  const { credential, hash } = auth
  // Every request of a user counts: 600 a minute (tool calls have their own 60).
  const now = hub.config.now()
  const requests = hub.limits.mcpRequests.check(credential.userId, now)
  if (!requests.ok) return rpcError(res, 429, "Too many requests. Wait, then try again.", { "retry-after": String(requests.retryAfterS) })
  hub.limits.mcpRequests.add(credential.userId, now)
  const patId = credential.credential.slice(4)
  if (credential.kind === "pat" && hub.agents.shouldTouch(patId, now)) hub.store.tokens.touchPersonal(patId, now)
  const info: AuthInfo = { token: hash, clientId: credential.credential, scopes: [], ...(credential.expires === null ? {} : { expiresAt: Math.floor(credential.expires / 1000) }), extra: { userId: credential.userId } }
  ;(req as IncomingMessage & { auth?: AuthInfo }).auth = info
  const sessionId = req.headers["mcp-session-id"]
  if (typeof sessionId === "string") {
    const entry = hub.agents.get(sessionId)
    if (!entry || entry.userId !== credential.userId || entry.credential !== credential.credential) return rpcError(res, 404, "Session not found")
    rememberToken(entry.tokenHashes, hash)
    if (method === "GET") openStream(hub, req, res, sessionId, credential)
    else hub.agents.touch(sessionId)
    for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value)
    return entry.handle(req, res, body)
  }
  if (method !== "POST" || !isInitializeRequest(body)) return rpcError(res, 400, "Start a session with an initialize request")
  return initialise(hub, req, res, body, credential, address)
}

/** The tokens a session was used with, the newest 16 (an OAuth client gets a new access token each hour). */
function rememberToken(hashes: Set<string>, hash: string): void {
  hashes.delete(hash)
  hashes.add(hash)
  while (hashes.size > 16) hashes.delete(hashes.values().next().value as string)
}

/** A GET stream: no idle socket timeout, ended at the token's expiry or after 15 minutes, whichever is first. */
function openStream(hub: Hub, req: IncomingMessage, res: ServerResponse, sessionId: string, credential: Credential): void {
  req.socket.setTimeout(0)
  hub.agents.streamOpened(sessionId)
  const now = hub.config.now()
  const endsAt = Math.min(credential.expires ?? Number.POSITIVE_INFINITY, now + MAX_STREAM_MS)
  const timer = setTimeout(() => res.end(), Math.max(0, endsAt - now))
  timer.unref()
  res.on("close", () => {
    clearTimeout(timer)
    hub.agents.streamClosed(sessionId)
  })
}

async function initialise(hub: Hub, req: IncomingMessage, res: ServerResponse, body: unknown, credential: Credential, address: string): Promise<void> {
  // Reserved now, before anything waits: concurrent initialises cannot pass the per-user limit together.
  const reservation = hub.agents.reserve(credential.userId)
  const state: AgentState = { userId: credential.userId, credential: credential.credential, closed: false }
  try {
    const server = new Server({ name: "copperflow", version: VERSION }, { capabilities: { tools: {} }, instructions: hub.catalog.instructions })
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: hub.catalog.tools }))
    server.setRequestHandler(CallToolRequestSchema, (request, extra) => {
      const info = extra.authInfo
      const auth: CallAuth = { hash: info?.token ?? "", userId: String(info?.extra?.userId ?? ""), credential: info?.clientId ?? "" }
      return callTool(hub, state, auth, request.params.name, request.params.arguments ?? {}, address, extra.signal)
    })
    const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedHosts: [hub.config.publicHost],
      onsessioninitialized: (id) => {
        hub.agents.register(reservation, id, {
          userId: state.userId,
          credential: state.credential,
          tokenHashes: new Set([(req as IncomingMessage & { auth?: AuthInfo }).auth?.token ?? ""]),
          handle: (r, s, b) => transport.handleRequest(r, s, b),
          close: () => void transport.close(),
        })
        audit(hub, address, state.userId, "agent-connected", state.credential.split(":")[0] ?? "")
      },
    })
    hub.agents.serverOpened()
    transport.onclose = () => {
      if (state.closed) return
      hub.agents.serverClosed()
      state.closed = true
      state.upstream?.close()
      state.upstream = undefined
      const id = transport.sessionId
      if (id !== undefined) hub.agents.forget(id)
      void server.close()
    }
    await server.connect(transport)
    const auth: CallAuth = { hash: (req as IncomingMessage & { auth?: AuthInfo }).auth?.token ?? "", userId: state.userId, credential: state.credential }
    if (!stillAuthorised(hub, state, auth)) {
      await transport.close()
      return rpcError(res, 401, "A valid bearer token is required.", { "www-authenticate": `Bearer resource_metadata="${resourceMetadataUrl(hub)}"` })
    }
    for (const [name, value] of Object.entries(CORS)) res.setHeader(name, value)
    try {
      await transport.handleRequest(req, res, body)
    } finally {
      // An initialise the transport refused (no session made): its server and transport are closed, not left behind.
      if (transport.sessionId === undefined) await transport.close()
    }
  } finally {
    // A registered session committed already; this gives back only a slot that never became a session.
    reservation.release()
  }
}
