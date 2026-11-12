// OAuth 2.1 for MCP clients, written on node:http with the SDK's schemas and types: the protected resource and
// authorisation server metadata, dynamic client registration (public clients only), the authorisation code flow with
// PKCE S256 and a consent page, the token endpoint (codes single use for 60 s; access tokens one hour; refresh tokens
// 30 days with rotation, a reused one revoking the whole grant) and revocation. Redirect URIs are compared exactly
// with the registered ones; nothing is ever redirected to an address that is not registered.
import { createHash } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { OAuthClientMetadataSchema, type OAuthMetadata, type OAuthProtectedResourceMetadata, type OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js"
import { consentPage } from "./agent-pages.js"
import { ACCESS_MS, ACCESS_PREFIX, labelOf, newToken, REFRESH_MS, REFRESH_PREFIX, tokenHash } from "./agent-tokens.js"
import { audit, epochOf, formTokenMatches, type Hub, type Signed } from "./context.js"
import { cookies, HubError, readBody, readForm, redirect, sendPage, setCookie } from "./http.js"
import { addressKey } from "./limits.js"
import { PENDING_MS } from "./oauth-state.js"
import { textPage } from "./pages.js"
import { hashSecret, newId, sameSecret } from "./secrets.js"

export const MAX_CLIENTS = 10_000
const MAX_REDIRECT_URIS = 5
const MAX_URI_LENGTH = 2000
const MAX_STATE_LENGTH = 1000
const REGISTER_BODY_LIMIT = 64 * 1024
const SECRET_TEXT = /^[A-Za-z0-9_-]{43}$/
const PKCE = /^[A-Za-z0-9._~-]{43,128}$/
const CLIENT_ID = /^[0-9a-f]{32}$/
const LOOPBACK = new Set(["127.0.0.1", "[::1]", "localhost"])
const CORS = { "access-control-allow-origin": "*" }

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff", ...CORS, ...headers })
  res.end(JSON.stringify(body))
}

function oauthError(res: ServerResponse, status: number, error: string, description: string): void {
  json(res, status, { error, error_description: description })
}

/** A preflight for the endpoints a browser-based client calls (no cookie is read on any of them). */
export function preflight(res: ServerResponse): void {
  res.writeHead(204, { ...CORS, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type, authorization, mcp-protocol-version", "access-control-max-age": "600" })
  res.end()
}

export function protectedResource(hub: Hub, res: ServerResponse): void {
  const body: OAuthProtectedResourceMetadata = {
    resource: `${hub.config.publicOrigin}/mcp`,
    authorization_servers: [hub.config.publicOrigin],
    bearer_methods_supported: ["header"],
    resource_name: "copperflow",
  }
  json(res, 200, body, { "cache-control": "public, max-age=3600" })
}

export function authorizationServer(hub: Hub, res: ServerResponse): void {
  const origin = hub.config.publicOrigin
  const body: OAuthMetadata = {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
  }
  json(res, 200, body, { "cache-control": "public, max-age=3600" })
}

/** https anywhere, or http on loopback; no user, password or fragment; at most 2000 characters. */
export function allowedRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > MAX_URI_LENGTH || uri.includes("#")) return false
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.username !== "" || url.password !== "") return false
  return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname))
}

/** POST /oauth/register: counted per address before the body is read. */
export async function register(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string): Promise<void> {
  const now = hub.config.now()
  const key = addressKey(address)
  const limit = hub.limits.register.check(key, now)
  if (!limit.ok) {
    audit(hub, address, null, "client-register-limited")
    return json(res, 429, { error: "slow_down", error_description: "Too many registrations. Try again later." }, { "retry-after": String(limit.retryAfterS) })
  }
  if (hub.limits.register.add(key, now) === "full") return json(res, 503, { error: "temporarily_unavailable", error_description: "Try again later." })
  let body: unknown
  try {
    body = JSON.parse((await readBody(req, REGISTER_BODY_LIMIT)).toString("utf8"))
  } catch (error) {
    if (error instanceof HubError && error.status === 413) return oauthError(res, 413, "invalid_client_metadata", "The registration is too large.")
    return oauthError(res, 400, "invalid_client_metadata", "The registration must be JSON.")
  }
  const parsed = OAuthClientMetadataSchema.safeParse(body)
  if (!parsed.success) return oauthError(res, 400, "invalid_client_metadata", "The registration is not valid client metadata.")
  const meta = parsed.data
  const uris = (body as { redirect_uris?: unknown }).redirect_uris as unknown[]
  if (uris.length < 1 || uris.length > MAX_REDIRECT_URIS || !uris.every(allowedRedirectUri)) {
    return oauthError(res, 400, "invalid_redirect_uri", `Give 1 to ${MAX_REDIRECT_URIS} redirect URIs, each https, or http on 127.0.0.1, [::1] or localhost.`)
  }
  if ((meta.token_endpoint_auth_method ?? "none") !== "none") return oauthError(res, 400, "invalid_client_metadata", "Only public clients (token_endpoint_auth_method none) are accepted.")
  if (!(meta.grant_types ?? ["authorization_code"]).every((g) => g === "authorization_code" || g === "refresh_token")) return oauthError(res, 400, "invalid_client_metadata", "Only authorization_code and refresh_token are supported.")
  if (!(meta.response_types ?? ["code"]).every((r) => r === "code")) return oauthError(res, 400, "invalid_client_metadata", "Only the code response type is supported.")
  const name = meta.client_name === undefined ? "Unnamed client" : labelOf(meta.client_name)
  if (!name) return oauthError(res, 400, "invalid_client_metadata", "client_name has 1 to 100 characters.")
  const id = newId()
  if (hub.store.tokens.addClient({ id, name, redirectUris: uris }, MAX_CLIENTS, hub.config.now()) === "full") {
    return json(res, 503, { error: "temporarily_unavailable", error_description: "Try again later." })
  }
  audit(hub, address, null, "client-registered", id)
  json(res, 201, {
    client_id: id,
    client_id_issued_at: Math.floor(hub.config.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  })
}

function oauthCookieName(hub: Hub): string {
  return hub.config.secure ? "__Host-copperflow-oauth" : "copperflow-oauth"
}

/** The authorisation request this browser is in the middle of, if any (the secret is in a cookie, never a URL). */
export function pendingRequest(hub: Hub, req: IncomingMessage): string | undefined {
  const secret = cookies(req).get(oauthCookieName(hub))
  return secret !== undefined && SECRET_TEXT.test(secret) && hub.oauth.request(secret, hub.config.now()) ? secret : undefined
}

/** A 303 to a registered redirect URI with the given answer (the URI was matched exactly before this is called). */
function answerClient(res: ServerResponse, redirectUri: string, params: Record<string, string | undefined>, headers: Record<string, string | string[]> = {}): void {
  const url = new URL(redirectUri)
  for (const [name, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(name, value)
  res.writeHead(303, { location: url.href, "cache-control": "no-store", "referrer-policy": "no-referrer", ...headers })
  res.end()
}

function badRequest(res: ServerResponse, text: string): void {
  sendPage(res, 400, textPage("That did not work", text))
}

/** GET /oauth/authorize. Signed out, the request is kept server-side and the person signs in first, then comes back to it. */
export function authorize(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed | undefined): void {
  const params = new URL(req.url ?? "/", "http://x").searchParams
  const one = (name: string) => (params.getAll(name).length === 1 ? params.get(name) ?? undefined : undefined)
  const clientId = one("client_id") ?? ""
  const client = CLIENT_ID.test(clientId) ? hub.store.tokens.client(clientId) : undefined
  const redirectUri = one("redirect_uri")
  // Until the client and the exact redirect URI are known, errors are shown here and never redirected.
  if (!client || redirectUri === undefined || !client.redirectUris.includes(redirectUri)) return badRequest(res, "This sign-in link is not valid: the application or its return address is not registered.")
  const now = hub.config.now()
  const key = addressKey(address)
  const limit = hub.limits.authorize.check(key, now)
  if (!limit.ok) return sendPage(res, 429, textPage("Too many requests", "Too many sign-in requests from this address. Try again later."), { "retry-after": String(limit.retryAfterS) })
  hub.limits.authorize.add(key, now)
  const state = one("state")
  const fail = (error: string, description: string) => answerClient(res, redirectUri, { error, error_description: description, ...(state !== undefined && state.length <= MAX_STATE_LENGTH ? { state } : {}), iss: hub.config.publicOrigin })
  if (state !== undefined && state.length > MAX_STATE_LENGTH) return fail("invalid_request", "state is too long")
  if (one("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported")
  const challenge = one("code_challenge")
  if (one("code_challenge_method") !== "S256" || challenge === undefined || !PKCE.test(challenge)) return fail("invalid_request", "PKCE with S256 is required")
  const resource = one("resource")
  if (resource !== undefined && resource !== `${hub.config.publicOrigin}/mcp` && resource !== hub.config.publicOrigin) return fail("invalid_target", "Unknown resource")
  const request = { clientId: client.id, redirectUri, challenge, state }
  if (signed && !signed.user.mustChangePassword) {
    const secret = hub.oauth.addRequest({ ...request, userId: signed.user.id }, now)
    return sendPage(res, 200, consentPage({ email: signed.user.email, formToken: signed.formToken }, secret, client.name, new URL(redirectUri).host))
  }
  const secret = hub.oauth.addRequest(request, now)
  const cookie = setCookie(oauthCookieName(hub), secret, { secure: hub.config.secure, maxAgeS: PENDING_MS / 1000 })
  redirect(res, signed ? "/account" : "/signin", { "set-cookie": cookie })
}

/** GET /oauth/continue: after sign-in, the consent page for the request this browser started. */
export function continueAuthorization(hub: Hub, req: IncomingMessage, res: ServerResponse, signed: Signed): void {
  const secret = pendingRequest(hub, req)
  const request = hub.oauth.request(secret, hub.config.now())
  if (!secret || !request) return redirect(res, "/projects")
  if (request.userId !== undefined && request.userId !== signed.user.id) throw new HubError(404, "There is no such page.")
  request.userId = signed.user.id
  const client = hub.store.tokens.client(request.clientId)
  if (!client) throw new HubError(404, "There is no such page.")
  sendPage(res, 200, consentPage({ email: signed.user.email, formToken: signed.formToken }, secret, client.name, new URL(request.redirectUri).host))
}

/** POST /oauth/consent: Allow or Deny, with the session's form token; the request is used up either way. */
export async function consent(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string, signed: Signed): Promise<void> {
  const form = await readForm(req)
  if (!formTokenMatches(signed, form.get("form"))) throw new HubError(403, "The form has expired. Open the page again and retry.")
  const now = hub.config.now()
  const request = hub.oauth.takeRequest(form.get("request"), now)
  const clear = setCookie(oauthCookieName(hub), "", { secure: hub.config.secure, maxAgeS: 0 })
  const client = request ? hub.store.tokens.client(request.clientId) : undefined
  if (!request || request.userId !== signed.user.id || !client || !client.redirectUris.includes(request.redirectUri)) {
    throw new HubError(404, "This request has expired. Start again from your application.")
  }
  const base = { state: request.state, iss: hub.config.publicOrigin }
  if (form.get("decision") !== "allow") {
    audit(hub, address, signed.user.id, "consent-denied", client.id)
    return answerClient(res, request.redirectUri, { error: "access_denied", ...base }, { "set-cookie": clear })
  }
  const code = hub.oauth.addCode({ clientId: client.id, redirectUri: request.redirectUri, challenge: request.challenge, userId: signed.user.id, epoch: epochOf(hub, signed.user.id) }, now)
  audit(hub, address, signed.user.id, "consent-allowed", client.id)
  answerClient(res, request.redirectUri, { code, ...base }, { "set-cookie": clear })
}

function issueTokens(hub: Hub, res: ServerResponse, userId: string, grantId: string): void {
  const now = hub.config.now()
  const access = newToken(ACCESS_PREFIX)
  const refresh = newToken(REFRESH_PREFIX)
  hub.store.tokens.issue({ hash: hashSecret(access), grantId, userId, kind: "access", expires: now + ACCESS_MS })
  hub.store.tokens.issue({ hash: hashSecret(refresh), grantId, userId, kind: "refresh", expires: now + REFRESH_MS })
  const body: OAuthTokens = { access_token: access, token_type: "Bearer", expires_in: ACCESS_MS / 1000, refresh_token: refresh }
  json(res, 200, body, { pragma: "no-cache" })
}

/** POST /oauth/token. Everything after the body arrives runs without waiting, so nothing can change between check and issue. */
export async function token(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string): Promise<void> {
  let form: Map<string, string>
  try {
    form = await readForm(req)
  } catch {
    return oauthError(res, 400, "invalid_request", "Send a form-encoded body.")
  }
  const grantType = form.get("grant_type")
  const clientId = form.get("client_id") ?? ""
  if (grantType === "authorization_code") return exchangeCode(hub, res, form, clientId, address)
  if (grantType === "refresh_token") return refreshTokens(hub, res, form, clientId, address)
  oauthError(res, 400, "unsupported_grant_type", "Use authorization_code or refresh_token.")
}

function userMayHaveTokens(hub: Hub, userId: string): boolean {
  const user = hub.store.userById(userId)
  return user !== undefined && !user.mustChangePassword
}

function exchangeCode(hub: Hub, res: ServerResponse, form: Map<string, string>, clientId: string, address: string): void {
  const now = hub.config.now()
  const given = form.get("code") ?? ""
  // Taken (and so used up) before anything else is checked: a code is good for one attempt.
  const code = SECRET_TEXT.test(given) ? hub.oauth.takeCode(given, now) : undefined
  const verifier = form.get("code_verifier") ?? ""
  const challenge = PKCE.test(verifier) ? createHash("sha256").update(verifier, "ascii").digest("base64url") : ""
  const good =
    code !== undefined &&
    sameSecret(code.clientId, clientId) &&
    sameSecret(code.redirectUri, form.get("redirect_uri") ?? "") &&
    sameSecret(code.challenge, challenge) &&
    code.epoch === epochOf(hub, code.userId) &&
    userMayHaveTokens(hub, code.userId) &&
    hub.store.tokens.client(clientId) !== undefined
  if (!code || !good) {
    audit(hub, address, code?.userId ?? null, "token-refused", "authorization_code")
    return oauthError(res, 400, "invalid_grant", "The code is not valid.")
  }
  const grantId = newId()
  hub.store.tokens.createGrant({ id: grantId, userId: code.userId, clientId }, now)
  audit(hub, address, code.userId, "grant-created", grantId)
  issueTokens(hub, res, code.userId, grantId)
}

function refreshTokens(hub: Hub, res: ServerResponse, form: Map<string, string>, clientId: string, address: string): void {
  const now = hub.config.now()
  const hash = tokenHash(form.get("refresh_token"), REFRESH_PREFIX)
  const access = newToken(ACCESS_PREFIX)
  const refresh = newToken(REFRESH_PREFIX)
  const next = [
    { hash: hashSecret(access), kind: "access" as const, expires: now + ACCESS_MS },
    { hash: hashSecret(refresh), kind: "refresh" as const, expires: now + REFRESH_MS },
  ]
  const result = hash === undefined ? { result: "missing" as const } : hub.store.tokens.rotateRefresh(hash, clientId, next, now)
  if (result.result === "reused") {
    // A refresh token used twice was stolen or replayed: the whole grant goes, and its sessions close.
    hub.agents.closeCredential(`grant:${result.grantId}`)
    audit(hub, address, result.userId, "refresh-reused-grant-revoked", result.grantId)
    return oauthError(res, 400, "invalid_grant", "The refresh token is not valid.")
  }
  if (result.result === "missing" || !userMayHaveTokens(hub, result.userId)) {
    audit(hub, address, null, "token-refused", "refresh_token")
    return oauthError(res, 400, "invalid_grant", "The refresh token is not valid.")
  }
  audit(hub, address, result.userId, "token-refreshed", result.grantId)
  const body: OAuthTokens = { access_token: access, token_type: "Bearer", expires_in: ACCESS_MS / 1000, refresh_token: refresh }
  json(res, 200, body, { pragma: "no-cache" })
}

/** POST /oauth/revoke (RFC 7009): always 200; an access token alone, a refresh token with its grant. */
export async function revoke(hub: Hub, req: IncomingMessage, res: ServerResponse, address: string): Promise<void> {
  let form: Map<string, string>
  try {
    form = await readForm(req)
  } catch {
    return oauthError(res, 400, "invalid_request", "Send a form-encoded body.")
  }
  const given = form.get("token")
  const hash = tokenHash(given, ACCESS_PREFIX) ?? tokenHash(given, REFRESH_PREFIX)
  const done = hash === undefined ? undefined : hub.store.tokens.revokeToken(hash, form.get("client_id") ?? "")
  if (done?.grantId !== undefined) {
    hub.agents.closeCredential(`grant:${done.grantId}`)
    audit(hub, address, done.userId, "grant-revoked", done.grantId)
  } else if (done) audit(hub, address, done.userId, "token-revoked", "access")
  json(res, 200, {})
}
