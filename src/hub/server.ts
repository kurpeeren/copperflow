// The hub: accounts, projects and the Studio proxy, on node:http with no framework. Every state-changing request is
// checked for the public Origin and a form token; every project route answers another user's project with 404; the
// proxy signs a one-minute workspace ticket only after all of that has passed.
import { mkdir } from "node:fs/promises"
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { Socket } from "node:net"
import { normaliseOrigin } from "../hosted/gate.js"
import { changePassword, deleteAccount, endAllSessions, showAccount, showSignIn, showSignUp, signIn, signOut, signUp } from "./account-routes.js"
import { newLimits, sessionOf, sweepCuts, type Hub, type HubConfig, type Signed } from "./context.js"
import { clientAddress, HubError, redirect, sameOrigin, sendPage } from "./http.js"
import { addressKey } from "./limits.js"
import { enterRedirect, projectOfHost, serveProjectOrigin, tlsAsk } from "./project-origin.js"
import { loadOrCreateTicketKey } from "./keys.js"
import { privacyPage, STYLESHEET, termsPage, textPage } from "./pages.js"
import { createProject, deleteProject, downloadProject, ownProject, renameProject, showProjects, uploadProject } from "./project-routes.js"
import { ProjectFiles } from "./projects.js"
import { createProcessRunner } from "./runner/process-runner.js"
import type { WorkspaceRunner } from "./runner/runner.js"
import { HubStore } from "./store.js"
import { prepareDataDir } from "./permissions.js"

export const MAX_PROJECTS = 20
export const MAX_BYTES = 200 * 1024 * 1024
const SWEEP_MS = 15_000
const PROXY_PATH = /^\/p\/([0-9a-f]{32})(?=\/|$|\?)/
const PROJECT_ACTION = /^\/projects\/([0-9a-f]{32})\/(rename|delete|download)$/
const SAFE_METHODS = new Set(["GET", "HEAD"])

/** Said once when the hub starts with the process runner, and by `hub invite`. */
export const TRUSTED_ONLY_WARNING =
  "Warning: workspaces run as plain processes of the hub's user, so every account can read every other account's data and the hub's keys. Invite only people you trust with all of it."
export const PROCESS_RUNNER_REFUSAL =
  "The hub has only the process runner, which is not a security boundary: every account could read every other account's data and the hub's keys. Start it with --trusted-accounts-only if every account is someone you trust with all of that."

export interface HubOptions {
  dataDir: string
  /** 0 picks a free port. */
  port: number
  publicOrigin: string
  /** Defaults to 127.0.0.1: the hub sits behind a TLS reverse proxy. */
  bind?: string
  /** Read the client's address from the last X-Forwarded-For entry (only behind a reverse proxy that sets it). */
  trustProxy?: boolean
  /**
   * The domain projects are served under: project `<id>` is `<id>.<workspaceDomain>` (such as ws.copperflow.example.com;
   * in tests ws.localhost). It needs a wildcard DNS record and a wildcard or on-demand certificate.
   */
  workspaceDomain: string
  /** The runner. Without one the hub uses the process runner, which is not a security boundary (process-runner.ts). */
  runner?: (publicKeyBase64: string) => WorkspaceRunner
  /** Must be true to start with the process runner: every account can then read every other account's data. */
  trustedAccountsOnly?: boolean
  maxProjects?: number
  maxBytes?: number
  /** The longest an ordinary request (not an upload) may take to arrive; default 60 s. */
  requestTimeoutMs?: number
  /** How often the hub sweeps sessions and carries out the maintainer's cuts; default 15 s. */
  sweepMs?: number
  /** Keys each limiter table holds; default 100 000 (tests make it small). */
  limiterKeys?: number
  now?: () => number
  log?: (line: string) => void
}

export interface HubServer {
  url: string
  hub: Hub
  close(): Promise<void>
}

/** Opens the data directory (made owner-only when new) and the store, key and runner in it. */
export async function openHub(options: Omit<HubOptions, "port" | "bind">): Promise<Hub> {
  if (!options.runner && !options.trustedAccountsOnly) throw new Error(PROCESS_RUNNER_REFUSAL)
  const dbFile = await prepareDataDir(options.dataDir)
  const keys = await loadOrCreateTicketKey(options.dataDir)
  const publicOrigin = normaliseOrigin(options.publicOrigin)
  const workspaceDomain = options.workspaceDomain.toLowerCase()
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(workspaceDomain)) throw new Error("--workspace-domain must be a domain name, such as ws.copperflow.example.com")
  const config: HubConfig = {
    publicOrigin,
    publicHost: new URL(publicOrigin).host,
    workspaceDomain,
    secure: publicOrigin.startsWith("https:"),
    trustProxy: options.trustProxy ?? false,
    maxProjects: options.maxProjects ?? MAX_PROJECTS,
    maxBytes: options.maxBytes ?? MAX_BYTES,
    now: options.now ?? Date.now,
  }
  const files = new ProjectFiles(options.dataDir)
  await mkdir(files.root, { recursive: true, mode: 0o700 })
  return {
    config,
    store: HubStore.open(dbFile),
    files,
    runner: options.runner ? options.runner(keys.publicKeyBase64) : createProcessRunner({ ticketPublicKey: keys.publicKeyBase64 }),
    keys,
    limits: newLimits(options.limiterKeys),
    userLocks: new Map(),
    userCuts: new Map(),
    epochs: new Map(),
    enterTokens: new Map(),
    transfers: { uploads: 0, uploadingUsers: new Set(), downloads: new Map() },
    log: options.log ?? ((line) => process.stderr.write(`copperflow hub: ${line}\n`)),
  }
}

export async function startHub(options: HubOptions): Promise<HubServer> {
  const hub = await openHub(options)
  const server = createServer((req, res) => {
    guard(req, res, options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS, hub.config.publicHost)
    route(hub, req, res).catch((error: unknown) => answerError(hub, res, error))
  })
  // Headers within 10 s; an idle socket closes after 60 s. Node's request timeout is server-wide, so it stays the
  // backstop at the longest an upload may take at its minimum rate; every other request gets its own 60 s clock in
  // `guard` (forms also 15 s in readBody), and uploads their rate and idle clocks (project-routes.ts).
  server.headersTimeout = HEADERS_TIMEOUT_MS
  server.requestTimeout = UPLOAD_BACKSTOP_MS
  server.timeout = SOCKET_IDLE_MS
  server.maxConnections = 1024
  limitConnectionsPerAddress(server, options.trustProxy ? undefined : MAX_CONNECTIONS_PER_ADDRESS)
  await new Promise<void>((done, fail) => {
    server.once("error", fail)
    server.listen(options.port, options.bind ?? "127.0.0.1", () => done())
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : options.port
  // Every 15 s: expired sessions go, and the cuts the maintainer's commands asked for are carried out.
  const sweep = setInterval(() => {
    hub.store.sweepSessions(hub.config.now())
    sweepCuts(hub).catch((error: unknown) => hub.log(`sweep failed: ${(error as Error).message}`))
  }, options.sweepMs ?? SWEEP_MS)
  sweep.unref()
  return {
    url: `http://${options.bind ?? "127.0.0.1"}:${port}`,
    hub,
    close: async () => {
      clearInterval(sweep)
      await hub.runner.stopAll()
      server.closeAllConnections()
      await new Promise<void>((done) => server.close(() => done()))
      hub.store.close()
    },
  }
}

const HEADERS_TIMEOUT_MS = 10_000
const SOCKET_IDLE_MS = 60_000
const REQUEST_TIMEOUT_MS = 60_000
/** 200 MB at the upload's minimum rate of 32 kB/s, with room: the longest any request body may take. */
const UPLOAD_BACKSTOP_MS = 2 * 60 * 60_000

/**
 * Per request: a body that is not in within `timeoutMs` ends the request (uploads, which keep their own clocks, are
 * exempt); and an answer given before the body was read says `connection: close` and closes the socket, so a
 * half-read request cannot linger.
 */
function guard(req: IncomingMessage, res: ServerResponse, timeoutMs: number, publicHost: string): void {
  const writeHead = res.writeHead.bind(res)
  res.writeHead = ((...args: Parameters<ServerResponse["writeHead"]>) => {
    if (!req.complete) res.setHeader("connection", "close")
    return writeHead(...args)
  }) as ServerResponse["writeHead"]
  const socket = req.socket
  res.once("finish", () => {
    if (!req.complete) socket?.destroySoon()
  })
  // Only the hub's own upload route, on the public origin; a path of that name on a project origin keeps the clock.
  const upload = req.method === "POST" && req.headers.host?.toLowerCase() === publicHost && (req.url ?? "").split("?")[0] === "/projects/upload"
  if (upload) return
  const late = setTimeout(() => {
    if (!req.complete) req.destroy()
  }, timeoutMs)
  late.unref()
  req.once("end", () => clearTimeout(late))
  res.once("close", () => clearTimeout(late))
}
export const MAX_CONNECTIONS_PER_ADDRESS = 64

/**
 * At most `max` open connections per client address; more are closed at once. Behind a reverse proxy every
 * connection comes from the proxy, so the cap is left to the proxy (`max` undefined).
 */
function limitConnectionsPerAddress(server: Server, max: number | undefined): void {
  if (max === undefined) return
  const open = new Map<string, number>()
  server.on("connection", (socket: Socket) => {
    const key = addressKey(socket.remoteAddress ?? "unknown")
    const count = (open.get(key) ?? 0) + 1
    if (count > max) {
      socket.destroy()
      return
    }
    open.set(key, count)
    socket.once("close", () => {
      const left = (open.get(key) ?? 1) - 1
      if (left > 0) open.set(key, left)
      else open.delete(key)
    })
  })
}

function answerError(hub: Hub, res: ServerResponse, error: unknown): void {
  if (res.headersSent) {
    res.destroy()
    return
  }
  if (error instanceof HubError) {
    sendPage(res, error.status, textPage(error.status === 404 ? "Not found" : "That did not work", error.message), error.headers)
    return
  }
  // Server side only: the person sees no stack, path or detail.
  hub.log(`request failed: ${(error as Error)?.stack ?? String(error)}`)
  sendPage(res, 500, textPage("Something went wrong", "Something went wrong on our side. Try again in a moment."))
}

async function route(hub: Hub, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const address = clientAddress(req, hub.config.trustProxy)
  // Two kinds of host: the public origin (the hub's pages) and one origin per project. Never the one for the other.
  const host = req.headers.host?.toLowerCase()
  const projectId = projectOfHost(hub, host)
  if (projectId) return serveProjectOrigin(hub, req, res, projectId, address)
  if (host !== hub.config.publicHost) throw new HubError(404, "There is no such page.")
  const raw = req.url ?? "/"
  if (PROXY_PATH.test(raw)) return enterProject(hub, req, res, raw)
  const query = raw.indexOf("?")
  const path = query < 0 ? raw : raw.slice(0, query)
  const method = req.method ?? "GET"
  if (!SAFE_METHODS.has(method)) {
    if (method !== "POST") throw new HubError(405, "That method is not allowed here.")
    // Before anything is read or decided: a form posted from another site is refused outright.
    if (!sameOrigin(req, hub.config.publicOrigin)) throw new HubError(403, "Forms can only be sent from this site.")
  }
  if (path === "/_tls-ask" && method === "GET") {
    const now = hub.config.now()
    const limit = hub.limits.tlsAsk.check(addressKey(address), now)
    if (!limit.ok) throw new HubError(429, "Too many requests.", { "retry-after": String(limit.retryAfterS) })
    hub.limits.tlsAsk.add(addressKey(address), now)
    return tlsAsk(hub, req, res)
  }
  if (path === "/static/hub.css" && SAFE_METHODS.has(method)) {
    res.writeHead(200, { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" })
    res.end(STYLESHEET)
    return
  }
  const { signed, renewed } = sessionOf(hub, req)
  const page = `${method === "HEAD" ? "GET" : method} ${path}`
  switch (page) {
    case "GET /":
      return signed ? redirect(res, "/projects") : showSignIn(hub, req, res)
    case "GET /signin":
      return signed ? redirect(res, "/projects") : showSignIn(hub, req, res)
    case "POST /signin":
      return signIn(hub, req, res, address)
    case "GET /signup":
      return signed ? redirect(res, "/projects") : showSignUp(hub, req, res)
    case "POST /signup":
      return signUp(hub, req, res, address)
    case "GET /privacy":
      return sendPage(res, 200, privacyPage(viewerOf(signed)))
    case "GET /terms":
      return sendPage(res, 200, termsPage(viewerOf(signed)))
  }
  if (!signed) {
    // Signed-out visitors learn nothing about what lies behind sign-in.
    if (SAFE_METHODS.has(method)) return redirect(res, "/signin")
    throw new HubError(403, "Sign in first.")
  }
  return signedRoute(hub, req, res, address, signed, renewed, page)
}

function viewerOf(signed: Signed | undefined) {
  return signed ? { email: signed.user.email, formToken: signed.formToken } : undefined
}

/** While a reset password waits to be replaced, only these routes are open. */
const WHILE_RESET = new Set(["GET /account", "POST /account/password", "POST /signout"])

async function signedRoute(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed, renewed: string | undefined, page: string): Promise<void> {
  if (signed.user.mustChangePassword && !WHILE_RESET.has(page)) {
    if (page.startsWith("GET ")) return redirect(res, "/account")
    throw new HubError(403, "Choose a new password on the account page first.")
  }
  switch (page) {
    case "POST /signout":
      return signOut(hub, req, res, address, signed)
    case "GET /projects":
      return showProjects(hub, res, signed, renewed)
    case "POST /projects":
      return createProject(hub, req, res, address, signed)
    case "POST /projects/upload":
      return uploadProject(hub, req, res, address, signed)
    case "GET /account":
      return showAccount(res, signed, renewed)
    case "POST /account/password":
      return changePassword(hub, req, res, address, signed)
    case "POST /account/delete":
      return deleteAccount(hub, req, res, address, signed)
    case "POST /account/end-sessions":
      return endAllSessions(hub, req, res, address, signed)
  }
  const [method, path] = page.split(" ") as [string, string]
  const action = PROJECT_ACTION.exec(path)
  if (action) {
    const [, id, verb] = action as unknown as [string, string, string]
    if (method === "GET" && verb === "download") return downloadProject(hub, res, address, signed, id)
    if (method === "POST" && verb === "rename") return renameProject(hub, req, res, address, signed, id)
    if (method === "POST" && verb === "delete") return deleteProject(hub, req, res, address, signed, id)
  }
  throw new HubError(404, "There is no such page.")
}

/**
 * The public origin's /p/<project id>/: the project is served on its own origin, so a signed-in owner is handed over
 * there with a one-time token. Nothing is proxied on the public origin.
 */
function enterProject(hub: Hub, req: IncomingMessage, res: ServerResponse, raw: string): void {
  const id = (PROXY_PATH.exec(raw) as RegExpExecArray)[1] as string
  if ((req.method ?? "GET") !== "GET") throw new HubError(404, "There is no such page.")
  const { signed } = sessionOf(hub, req)
  if (!signed) return redirect(res, "/signin")
  if (signed.user.mustChangePassword) return redirect(res, "/account")
  ownProject(hub, signed, id)
  enterRedirect(hub, res, signed, id)
}
