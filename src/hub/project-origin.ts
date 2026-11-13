// Workspaces on their own origins. A project is served on `<project id>.<workspace domain>`, never on the public
// origin, so nothing a project serves shares an origin with the hub's pages. The public origin's /p/<id>/ hands a
// signed-in owner over with a one-time token (30 s, single use, bound to user and project); /_enter on the project
// origin turns it into a workspace session cookie (12 h, ended with the user's hub sessions). Every request on a
// project origin is authenticated by that cookie only, checked against the project in the Host, then proxied with a
// ticket signed last, just before the upstream request.
import type { IncomingMessage, ServerResponse } from "node:http"
import { signTicket, nowSeconds } from "../hosted/ticket.js"
import { auditRoutine, cutSignal, epochOf, type Hub, type Signed } from "./context.js"
import { cookies, header, HubError, setCookie } from "./http.js"
import { proxyRequest } from "./proxy.js"
import { DEFAULT_MAX_HOLD_MS, RunnerFullError, WorkspaceBackoffError, WorkspaceStartError } from "./runner/runner.js"
import { OverQuotaError, ProjectBusyError } from "./quota.js"
import { hashSecret, newSecret } from "./secrets.js"
import { FORM_BODY_LIMIT } from "./http.js"

const ENTER_MS = 30_000
const WORKSPACE_SESSION_MS = 12 * 60 * 60_000
const TICKET_LIFETIME_S = 60
export const MAX_ENTER_TOKENS = 10_000
/** Live enter tokens one user may hold: a fifth replaces their oldest. */
export const MAX_ENTER_TOKENS_PER_USER = 4
const SECRET_TEXT = /^[A-Za-z0-9_-]{43}$/
const SAFE = new Set(["GET", "HEAD"])

/** The origin a project is served on. */
export function projectOrigin(hub: Hub, id: string): string {
  const pub = new URL(hub.config.publicOrigin)
  return `${pub.protocol}//${id}.${hub.config.workspaceDomain}${pub.port ? `:${pub.port}` : ""}`
}

/** The project id when `host` is a project origin's host, else undefined. */
export function projectOfHost(hub: Hub, host: string | undefined): string | undefined {
  if (!host) return undefined
  const pub = new URL(hub.config.publicOrigin)
  const suffix = `.${hub.config.workspaceDomain}${pub.port ? `:${pub.port}` : ""}`
  const lower = host.toLowerCase()
  if (!lower.endsWith(suffix)) return undefined
  const id = lower.slice(0, -suffix.length)
  return /^[0-9a-f]{32}$/.test(id) ? id : undefined
}

function workspaceCookieName(hub: Hub): string {
  return hub.config.secure ? "__Host-copperflow-workspace" : "copperflow-workspace"
}

/** Forgets an enter token everywhere it is kept; returns it. */
function dropEnterToken(hub: Hub, hash: string) {
  const found = hub.enterTokens.get(hash)
  hub.enterTokens.delete(hash)
  if (found) {
    const rest = (hub.enterByUser.get(found.userId) ?? []).filter((other) => other !== hash)
    if (rest.length > 0) hub.enterByUser.set(found.userId, rest)
    else hub.enterByUser.delete(found.userId)
  }
  return found
}

/** The public origin's /p/<id>/: a one-time token, then a redirect to the project's own origin. */
export function enterRedirect(hub: Hub, res: ServerResponse, signed: Signed, projectId: string): void {
  const now = hub.config.now()
  const userId = signed.user.id
  // This user's own tokens first: expired ones go, and a fifth live one replaces the oldest, so one user can never hold
  // more than MAX_ENTER_TOKENS_PER_USER of the hub's slots.
  for (const hash of [...(hub.enterByUser.get(userId) ?? [])]) if ((hub.enterTokens.get(hash)?.expires ?? 0) <= now) dropEnterToken(hub, hash)
  for (let mine = hub.enterByUser.get(userId); mine && mine.length >= MAX_ENTER_TOKENS_PER_USER; mine = hub.enterByUser.get(userId)) dropEnterToken(hub, mine[0] as string)
  if (hub.enterTokens.size >= MAX_ENTER_TOKENS) for (const [hash, found] of [...hub.enterTokens]) if (found.expires <= now) dropEnterToken(hub, hash)
  if (hub.enterTokens.size >= MAX_ENTER_TOKENS) throw new HubError(503, "Too many projects are being opened right now. Try again in a moment.")
  const token = newSecret()
  const hash = hashSecret(token)
  hub.enterTokens.set(hash, { userId, projectId, expires: now + ENTER_MS, epoch: epochOf(hub, userId), hubSession: signed.sessionHash })
  hub.enterByUser.set(userId, [...(hub.enterByUser.get(userId) ?? []), hash])
  res.writeHead(303, { location: `${projectOrigin(hub, projectId)}/_enter?t=${token}`, "cache-control": "no-store", "referrer-policy": "no-referrer" })
  res.end()
}

/** The owner of a project that still exists, or undefined. */
function owner(hub: Hub, userId: string, projectId: string) {
  const user = hub.store.userById(userId)
  if (!user || user.mustChangePassword || !hub.store.project(userId, projectId)) return undefined
  return user
}

function enter(hub: Hub, req: IncomingMessage, res: ServerResponse, projectId: string, address: string): void {
  const token = new URL(req.url ?? "/", "http://x").searchParams.get("t") ?? ""
  const hash = SECRET_TEXT.test(token) ? hashSecret(token) : ""
  const found = dropEnterToken(hub, hash)
  const now = hub.config.now()
  const hubSession = found ? hub.store.session(found.hubSession, now) : undefined
  if (!found || !hubSession || hubSession.userId !== found.userId || found.expires <= now || found.projectId !== projectId || found.epoch !== epochOf(hub, found.userId) || !owner(hub, found.userId, projectId)) {
    throw new HubError(404, "There is no such page.")
  }
  const secret = newSecret()
  // Never beyond the hub session it came from.
  const expires = Math.min(now + WORKSPACE_SESSION_MS, hubSession.expires)
  hub.store.createWorkspaceSession(hashSecret(secret), found.userId, projectId, found.hubSession, expires)
  auditRoutine(hub, address, found.userId, "workspace-entered", projectId)
  res.writeHead(303, {
    location: "/",
    "cache-control": "no-store",
    // Unregisters any Service Worker and clears what the origin's content stored.
    "clear-site-data": '"storage"',
    "referrer-policy": "no-referrer",
    "set-cookie": setCookie(workspaceCookieName(hub), secret, { secure: hub.config.secure, maxAgeS: (expires - now) / 1000 }),
  })
  res.end()
}

/** The user a request on this project origin belongs to, by its workspace cookie (exactly one), or undefined. */
function workspaceUser(hub: Hub, req: IncomingMessage, projectId: string): string | undefined {
  const secret = cookies(req).get(workspaceCookieName(hub))
  if (secret === undefined || !SECRET_TEXT.test(secret)) return undefined
  const now = hub.config.now()
  const session = hub.store.workspaceSession(hashSecret(secret), now)
  if (!session || session.projectId !== projectId || !owner(hub, session.userId, projectId)) return undefined
  // The hub session it came from must still be live (not signed out, not expired).
  if (hub.store.session(session.hubSession, now)?.userId !== session.userId) return undefined
  return session.userId
}

/** A path two parsers could read differently is refused: backslashes, encoded slashes, and . or .. segments. */
function plainPath(path: string): boolean {
  if (!path.startsWith("/") || path.includes("\\") || /%(2f|5c)/i.test(path)) return false
  return path.split("/").every((segment, index, all) => {
    if (segment === "") return index === 0 || index === all.length - 1
    const decoded = segment.replace(/%2e/gi, ".")
    return decoded !== "." && decoded !== ".."
  })
}

/**
 * Rule 4 of docs/hosted.md: no ticket is ever made for a request from another origin, sibling projects included (they
 * are same-site). An Origin, when sent, must be this project's. Without one, `Sec-Fetch-Site` must be `same-origin` or
 * `none` (typed or bookmarked); a page (not /api/) may also be reached by a top-level navigation from elsewhere. A
 * browser too old to send Sec-Fetch headers is let through on requests without an Origin (modern browsers send an
 * Origin on every POST, so such a request is a GET of a page or of the API).
 */
export function fromThisOrigin(req: IncomingMessage, method: string, path: string, origin: string): boolean {
  const sent = header(req, "origin")
  if (sent !== undefined) return sent === origin
  const site = header(req, "sec-fetch-site")
  if (site === undefined || site === "same-origin" || site === "none") return true
  return SAFE.has(method) && !path.startsWith("/api/") && header(req, "sec-fetch-mode") === "navigate"
}

/** Every request on a project origin. The hub's own pages are never served here. */
export async function serveProjectOrigin(hub: Hub, req: IncomingMessage, res: ServerResponse, projectId: string, address: string): Promise<void> {
  const raw = req.url ?? "/"
  const query = raw.indexOf("?")
  const path = query < 0 ? raw : raw.slice(0, query)
  if (!plainPath(path)) throw new HubError(400, "That address is not valid.")
  // The agent's endpoint lives on the public origin only.
  if (path === "/mcp" || path.startsWith("/mcp/")) throw new HubError(404, "There is no such page.")
  // No worker script is ever served on a project origin: a Service Worker could read the next /_enter token.
  if (header(req, "service-worker") !== undefined) throw new HubError(404, "There is no such page.")
  const method = req.method ?? "GET"
  if (path === "/_enter" && method === "GET") return enter(hub, req, res, projectId, address)
  const userId = workspaceUser(hub, req, projectId)
  if (!userId) {
    // A page without its cookie goes back through the hub, which hands over a fresh token to a signed-in owner.
    if (SAFE.has(method) && !path.startsWith("/api/")) {
      res.writeHead(303, { location: `${hub.config.publicOrigin}/p/${projectId}/`, "cache-control": "no-store" })
      res.end()
      return
    }
    throw new HubError(404, "There is no such page.")
  }
  if (!fromThisOrigin(req, method, path, projectOrigin(hub, projectId))) throw new HubError(403, "Requests from another site are not allowed.")
  // Taken before anything waits: a revocation during the wait is seen below.
  const signal = cutSignal(hub, userId)
  const epoch = epochOf(hub, userId)
  const stillValid = () => !signal.aborted && epochOf(hub, userId) === epoch && workspaceUser(hub, req, projectId) === userId
  let target
  try {
    target = await hub.runner.ensure({ id: projectId, userId, projectDir: hub.files.projectDir(userId, projectId), basePath: "", publicOrigin: projectOrigin(hub, projectId) })
  } catch (error) {
    if (!stillValid()) throw new HubError(404, "There is no such page.")
    if (error instanceof OverQuotaError) throw new HubError(403, error.message)
    if (error instanceof ProjectBusyError) throw new HubError(503, error.message, { "retry-after": "5" })
    if (error instanceof WorkspaceBackoffError) throw new HubError(503, error.message, { "retry-after": String(error.retryAfterS) })
    if (error instanceof RunnerFullError || error instanceof WorkspaceStartError) throw new HubError(503, error.message, { "retry-after": "60" })
    throw error
  }
  if (!stillValid()) throw new HubError(404, "There is no such page.")
  const release = hub.runner.hold(projectId)
  try {
    await proxyRequest(req, res, {
      origin: target.studio,
      path: raw,
      publicHost: new URL(projectOrigin(hub, projectId)).host,
      projectOrigin: projectOrigin(hub, projectId),
      frameAncestor: hub.config.publicOrigin,
      // Signed last, immediately before the upstream request, and only if the session still holds.
      ticket: () => {
        if (!stillValid()) return undefined
        const iat = nowSeconds()
        return signTicket({ w: projectId, u: userId, iat, exp: iat + TICKET_LIFETIME_S }, hub.keys.privateKey)
      },
      maxBodyBytes: FORM_BODY_LIMIT,
      maxDurationMs: DEFAULT_MAX_HOLD_MS,
      signal,
    })
  } finally {
    release()
  }
}

/** For a reverse proxy that issues certificates on demand: 200 only for the public host and existing projects. */
export function tlsAsk(hub: Hub, req: IncomingMessage, res: ServerResponse): void {
  const domain = (new URL(req.url ?? "/", "http://x").searchParams.get("domain") ?? "").toLowerCase()
  const publicHostname = new URL(hub.config.publicOrigin).hostname
  const suffix = `.${hub.config.workspaceDomain}`
  const id = domain.endsWith(suffix) ? domain.slice(0, -suffix.length) : ""
  const ok = domain === publicHostname || (/^[0-9a-f]{32}$/.test(id) && hub.store.projectExists(id))
  res.writeHead(ok ? 200 : 404, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" })
  res.end(ok ? "ok" : "no")
}
