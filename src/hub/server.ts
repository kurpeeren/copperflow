// The hub: accounts, projects and the Studio proxy, on node:http with no framework. Every state-changing request is
// checked for the public Origin and a form token; every project route answers another user's project with 404; the
// proxy signs a one-minute workspace ticket only after all of that has passed.
import { mkdir } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { normaliseOrigin } from "../hosted/gate.js"
import { nowSeconds, signTicket } from "../hosted/ticket.js"
import { changePassword, deleteAccount, showAccount, showSignIn, showSignUp, signIn, signOut, signUp } from "./account-routes.js"
import { newLimits, sessionOf, type Hub, type HubConfig, type Signed } from "./context.js"
import { clientAddress, FORM_BODY_LIMIT, header, HubError, redirect, sameOrigin, sendPage } from "./http.js"
import { loadOrCreateTicketKey } from "./keys.js"
import { privacyPage, STYLESHEET, termsPage, textPage } from "./pages.js"
import { createProject, deleteProject, downloadProject, ownProject, renameProject, showProjects, uploadProject } from "./project-routes.js"
import { ProjectFiles } from "./projects.js"
import { proxyRequest } from "./proxy.js"
import { createProcessRunner } from "./runner/process-runner.js"
import { RunnerFullError, WorkspaceStartError, type WorkspaceRunner } from "./runner/runner.js"
import { HubStore } from "./store.js"
import { join } from "node:path"

export const MAX_PROJECTS = 20
export const MAX_BYTES = 200 * 1024 * 1024
const TICKET_LIFETIME_S = 60
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
  /** The runner. Without one the hub uses the process runner, which is not a security boundary (process-runner.ts). */
  runner?: (publicKeyBase64: string, publicOrigin: string) => WorkspaceRunner
  /** Must be true to start with the process runner: every account can then read every other account's data. */
  trustedAccountsOnly?: boolean
  maxProjects?: number
  maxBytes?: number
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
  await mkdir(options.dataDir, { recursive: true, mode: 0o700 })
  const keys = await loadOrCreateTicketKey(options.dataDir)
  const publicOrigin = normaliseOrigin(options.publicOrigin)
  const config: HubConfig = {
    publicOrigin,
    publicHost: new URL(publicOrigin).host,
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
    store: HubStore.open(join(options.dataDir, "hub.db")),
    files,
    runner: options.runner ? options.runner(keys.publicKeyBase64, publicOrigin) : createProcessRunner({ publicOrigin, ticketPublicKey: keys.publicKeyBase64 }),
    keys,
    limits: newLimits(options.limiterKeys),
    userLocks: new Map(),
    log: options.log ?? ((line) => process.stderr.write(`copperflow hub: ${line}\n`)),
  }
}

export async function startHub(options: HubOptions): Promise<HubServer> {
  const hub = await openHub(options)
  const server = createServer((req, res) => {
    route(hub, req, res).catch((error: unknown) => answerError(hub, res, error))
  })
  server.headersTimeout = 15_000
  // Uploads of up to 200 MB need time on a slow line; event streams are responses and are not cut by this.
  server.requestTimeout = 10 * 60_000
  server.maxConnections = 1024
  await new Promise<void>((done, fail) => {
    server.once("error", fail)
    server.listen(options.port, options.bind ?? "127.0.0.1", () => done())
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : options.port
  const sweep = setInterval(() => hub.store.sweepSessions(hub.config.now()), 60 * 60_000)
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
  const raw = req.url ?? "/"
  if (PROXY_PATH.test(raw)) return proxy(hub, req, res, raw)
  const query = raw.indexOf("?")
  const path = query < 0 ? raw : raw.slice(0, query)
  const method = req.method ?? "GET"
  if (!SAFE_METHODS.has(method)) {
    if (method !== "POST") throw new HubError(405, "That method is not allowed here.")
    // Before anything is read or decided: a form posted from another site is refused outright.
    if (!sameOrigin(req, hub.config.publicOrigin)) throw new HubError(403, "Forms can only be sent from this site.")
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

async function signedRoute(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed, renewed: string | undefined, page: string): Promise<void> {
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

/** A path two parsers could read differently is refused: backslashes, encoded slashes, and . or .. segments. */
function plainPath(path: string): boolean {
  if (path.includes("\\") || /%(2f|5c)/i.test(path)) return false
  return path.split("/").every((segment, index, all) => {
    if (segment === "") return index === 0 || index === all.length - 1
    const decoded = segment.replace(/%2e/gi, ".")
    return decoded !== "." && decoded !== ".."
  })
}

/** /p/<project id>/… → the workspace's Studio, after the session, the owner and the Origin are checked. */
async function proxy(hub: Hub, req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
  const id = (PROXY_PATH.exec(raw) as RegExpExecArray)[1] as string
  const query = raw.indexOf("?")
  if (!plainPath(query < 0 ? raw : raw.slice(0, query))) throw new HubError(400, "That address is not valid.")
  const method = req.method ?? "GET"
  const { signed } = sessionOf(hub, req)
  if (!signed) {
    if (SAFE_METHODS.has(method) && !raw.startsWith(`/p/${id}/api/`)) return redirect(res, "/signin")
    throw new HubError(404, "There is no such page.")
  }
  ownProject(hub, signed, id)
  // Rule 4 of docs/hosted.md: no ticket is ever made for a cross-site request.
  const origin = header(req, "origin")
  const crossSite = origin !== undefined ? origin !== hub.config.publicOrigin : header(req, "sec-fetch-site") === "cross-site" && (!SAFE_METHODS.has(method) || raw.startsWith(`/p/${id}/api/`))
  if (crossSite) throw new HubError(403, "Requests from another site are not allowed.")
  let address
  try {
    address = await hub.runner.ensure({ id, userId: signed.user.id, projectDir: hub.files.projectDir(signed.user.id, id), basePath: `/p/${id}` })
  } catch (error) {
    if (error instanceof RunnerFullError || error instanceof WorkspaceStartError) throw new HubError(503, error.message, { "retry-after": "60" })
    throw error
  }
  const release = hub.runner.hold(id)
  try {
    const iat = nowSeconds()
    const ticket = signTicket({ w: id, u: signed.user.id, iat, exp: iat + TICKET_LIFETIME_S }, hub.keys.privateKey)
    await proxyRequest(req, res, { origin: address.studio, path: raw, publicHost: hub.config.publicHost, ticket, maxBodyBytes: FORM_BODY_LIMIT })
  } finally {
    release()
  }
}
