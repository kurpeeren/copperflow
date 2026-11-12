// Forwards a tool call to the open project's workspace: the hub ensures the workspace, then calls the tool on the
// workspace's MCP server as an MCP client over HTTP, with Host set to the project origin's host and a ticket signed
// just before each request for the calling user. The authorisation is re-checked after every wait, and the ticket is
// signed only if it still holds and the user's revocation epoch has not moved. The answer passes through unchanged.
import { request } from "node:http"
import { PassThrough, Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { CallToolResultSchema, McpError, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { nowSeconds, signTicket, TICKET_HEADER } from "../hosted/ticket.js"
import { epochOf, type Hub } from "./context.js"
import type { AgentState, CallAuth } from "./hub-tools.js"
import { stillAuthorised, text } from "./hub-tools.js"
import { projectOrigin } from "./project-origin.js"
import { RunnerFullError, WorkspaceStartError } from "./runner/runner.js"

const TICKET_LIFETIME_S = 60
/** The longest one forwarded call may take, and the most bytes an answer may have. */
export const FORWARD_TIMEOUT_MS = 5 * 60_000
export const MAX_ANSWER_BYTES = 16 * 1024 * 1024

/** A connection to one workspace's MCP server, for one agent session, at one revocation epoch. */
export interface Upstream {
  projectId: string
  mcp: string
  epoch: number
  client: Client
  /** The credential of the call being forwarded now: the ticket is signed only while it holds. */
  current: { auth: CallAuth }
  close(): void
}

const REVOKED = "Access was revoked. Connect again."

/** Fails the chain once more than `limit` bytes have passed. */
function limitTo(limit: number): Transform {
  let size = 0
  return new Transform({
    transform(chunk: Buffer, _encoding, next) {
      size += chunk.length
      next(size > limit ? new Error("The workspace's answer is too large") : null, chunk)
    },
  })
}

/**
 * The fetch the upstream client uses: node:http, so Host can be the project origin's; GET (the server's stream) is
 * answered 405 here, since nothing the hub forwards needs it. `sign` gives the ticket at the last moment, or
 * undefined when the authorisation no longer holds, and then nothing is sent.
 */
function ticketFetch(projectHost: string, sign: () => string | undefined): (url: string | URL, init?: RequestInit) => Promise<Response> {
  return async (url, init) => {
    const method = init?.method ?? "GET"
    if (method === "GET") return new Response(null, { status: 405 })
    const ticket = sign()
    if (ticket === undefined) throw new Error(REVOKED)
    const target = new URL(url)
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((value, name) => (headers[name] = value))
    headers.host = projectHost
    headers[TICKET_HEADER] = ticket
    const body = typeof init?.body === "string" ? init.body : undefined
    return new Promise<Response>((done, fail) => {
      const req = request({ host: target.hostname, port: target.port, method, path: `${target.pathname}${target.search}`, headers, signal: init?.signal ?? undefined }, (res) => {
        const answerHeaders = new Headers()
        for (const [name, value] of Object.entries(res.headers)) {
          if (value === undefined) continue
          for (const one of Array.isArray(value) ? value : [value]) answerHeaders.append(name, one)
        }
        const status = res.statusCode ?? 502
        if (status === 204 || status === 205 || status === 304) {
          res.resume()
          return done(new Response(null, { status, headers: answerHeaders }))
        }
        const out = new PassThrough()
        // Every stage is destroyed if any fails; the error ends the client's read, never the process.
        pipeline(res, limitTo(MAX_ANSWER_BYTES), out).catch(() => undefined)
        done(new Response(Readable.toWeb(out) as ReadableStream, { status, headers: answerHeaders }))
      })
      req.on("error", fail)
      req.end(body)
    })
  }
}

async function connect(hub: Hub, state: AgentState, auth: CallAuth, projectId: string, mcp: string, epoch: number): Promise<Upstream> {
  const origin = projectOrigin(hub, projectId)
  const current = { auth }
  const sign = () => {
    // Signed last, only while the session, its token and the epoch hold, for the user's own project.
    if (!stillAuthorised(hub, state, current.auth) || epochOf(hub, state.userId) !== epoch || state.projectId !== projectId || !hub.store.project(state.userId, projectId)) return undefined
    const iat = nowSeconds()
    return signTicket({ w: projectId, u: state.userId, iat, exp: iat + TICKET_LIFETIME_S }, hub.keys.privateKey)
  }
  const transport = new StreamableHTTPClientTransport(new URL(`${mcp}/mcp`), { fetch: ticketFetch(new URL(origin).host, sign) })
  const client = new Client({ name: "copperflow-hub", version: "1" })
  await client.connect(transport)
  hub.agents.upstreamOpened()
  let open = true
  const close = () => {
    if (!open) return
    open = false
    hub.agents.upstreamClosed()
    void client.close().catch(() => undefined)
  }
  return { projectId, mcp, epoch, client, current, close }
}

/**
 * The session's one connection to the workspace (single flight): concurrent calls share one connect in flight, so a
 * session never holds more than one workspace MCP session. A connection that finishes after the session closed, or
 * after another connect replaced it, is closed at once.
 */
function upstreamFor(hub: Hub, state: AgentState, auth: CallAuth, projectId: string, mcp: string, epoch: number): Promise<Upstream> {
  const key = `${projectId} ${mcp} ${epoch}`
  const known = state.upstream
  if (known && `${known.projectId} ${known.mcp} ${known.epoch}` === key) return Promise.resolve(known)
  if (state.connecting?.key === key) return state.connecting.promise
  known?.close()
  state.upstream = undefined
  const promise: Promise<Upstream> = connect(hub, state, auth, projectId, mcp, epoch).then(
    (made) => {
      // Also closed when access was revoked while it connected: the epoch moved or the token no longer holds.
      if (state.closed || state.connecting?.promise !== promise || epochOf(hub, state.userId) !== epoch || !stillAuthorised(hub, state, made.current.auth)) {
        made.close()
        throw new Error(REVOKED)
      }
      state.connecting = undefined
      state.upstream = made
      return made
    },
    (error: unknown) => {
      if (state.connecting?.promise === promise) state.connecting = undefined
      throw error
    },
  )
  state.connecting = { key, promise }
  promise.catch(() => undefined)
  return promise
}

/** Forwards one call; any failure is an answer the agent can read, never a thrown error. */
export async function forwardTool(hub: Hub, state: AgentState, auth: CallAuth, projectId: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallToolResult> {
  const epoch = epochOf(hub, state.userId)
  const holds = () => stillAuthorised(hub, state, auth) && epochOf(hub, state.userId) === epoch && state.projectId === projectId && hub.store.project(state.userId, projectId) !== undefined
  let address
  try {
    address = await hub.runner.ensure({ id: projectId, userId: state.userId, projectDir: hub.files.projectDir(state.userId, projectId), basePath: "", publicOrigin: projectOrigin(hub, projectId) })
  } catch (error) {
    if (!holds()) return text(REVOKED, true)
    if (error instanceof RunnerFullError || error instanceof WorkspaceStartError) return text(error.message, true)
    hub.log(`workspace start for an agent failed: ${(error as Error).message}`)
    return text("The workspace could not be started. Try again in a minute.", true)
  }
  if (!holds()) return text(REVOKED, true)
  const release = hub.runner.hold(projectId)
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await upstreamFor(hub, state, auth, projectId, address.mcp, epoch)
      if (!holds()) return text(REVOKED, true)
      current.current.auth = auth
      try {
        return (await current.client.request({ method: "tools/call", params: { name, arguments: args } }, CallToolResultSchema, { signal, timeout: FORWARD_TIMEOUT_MS })) as CallToolResult
      } catch (error) {
        // One call cancelled, timed out or refused by the workspace leaves the shared connection to the session's other
        // calls; only a failure of the transport itself replaces it.
        const transportFailed = error instanceof StreamableHTTPError || (!(error instanceof McpError) && !signal.aborted)
        if (!transportFailed) throw error
        current.close()
        if (state.upstream === current) state.upstream = undefined
        // The workspace forgot the session (it restarted): nothing ran, so the call is tried once more.
        if (attempt === 0 && error instanceof StreamableHTTPError && error.code === 404 && holds()) continue
        throw error
      }
    }
    throw new Error("unreachable")
  } catch (error) {
    if (!holds() || (error as Error).message === REVOKED) return text(REVOKED, true)
    hub.log(`forwarded call failed: ${(error as Error).message}`)
    return text("The workspace did not answer. Try again in a moment.", true)
  } finally {
    release()
  }
}
