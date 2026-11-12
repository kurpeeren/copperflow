import { afterEach, describe, expect, test } from "vitest"
import { createHash } from "node:crypto"
import type { HubServer } from "../src/hub/server.js"
import { Browser, formToken, invite, ORIGIN, send, startTestHub } from "./helpers/hub-client.js"
import { call, connectAgent } from "./helpers/hub-mcp.js"

const HOST = new URL(ORIGIN).host
const REDIRECT = "http://127.0.0.1:33418/callback"
const VERIFIER = "v".repeat(20) + "-verifier-" + "x".repeat(30)
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url")

let server: HubServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function registerClient(hub: HubServer, meta: Record<string, unknown>) {
  const answer = await send(hub.url, "POST", "/oauth/register", { host: HOST, "content-type": "application/json" }, JSON.stringify(meta))
  return { status: answer.status, body: JSON.parse(answer.text) as Record<string, unknown> }
}

async function tokenRequest(hub: HubServer, fields: Record<string, string>) {
  const answer = await send(hub.url, "POST", "/oauth/token", { host: HOST, "content-type": "application/x-www-form-urlencoded" }, new URLSearchParams(fields).toString())
  return { status: answer.status, body: JSON.parse(answer.text) as Record<string, string> }
}

function authorizePath(clientId: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: CHALLENGE, code_challenge_method: "S256", state: "st-1", ...extra })
  return `/oauth/authorize?${params}`
}

/** Signed in already: authorize shows consent at once; Allow answers with a code. */
async function codeFor(browser: Browser, clientId: string): Promise<string> {
  const page = await browser.get(authorizePath(clientId))
  const request = /name="request" value="([^"]+)"/.exec(page.text)?.[1] as string
  const allowed = await browser.post("/oauth/consent", { form: formToken(page.text), request, decision: "allow" })
  return new URL(String(allowed.headers.location)).searchParams.get("code") as string
}

describe("OAuth for MCP clients", () => {
  test("metadata names the endpoints and the resource", async () => {
    server = await startTestHub()
    const resource = JSON.parse((await send(server.url, "GET", "/.well-known/oauth-protected-resource", { host: HOST })).text)
    expect(resource).toEqual({ resource: `${ORIGIN}/mcp`, authorization_servers: [ORIGIN], bearer_methods_supported: ["header"], resource_name: "copperflow" })
    const meta = JSON.parse((await send(server.url, "GET", "/.well-known/oauth-authorization-server", { host: HOST })).text)
    expect(meta.token_endpoint).toBe(`${ORIGIN}/oauth/token`)
    expect(meta.code_challenge_methods_supported).toEqual(["S256"])
    expect(meta.token_endpoint_auth_methods_supported).toEqual(["none"])
  })

  test("the whole flow: register, authorize signed out then in, consent, code, refresh rotation, reuse revokes the grant, revoke", async () => {
    server = await startTestHub()
    const { status, body } = await registerClient(server, { client_name: "Test <script>alert(1)</script>", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" })
    expect(status).toBe(201)
    const clientId = body.client_id as string
    const browser = new Browser(server.url)
    await browser.signUp(invite(server), "ada@example.com")
    await browser.post("/signout", { form: formToken((await browser.get("/account")).text) })
    // Signed out: sign in first, then back to the same request, kept server-side.
    const first = await browser.get(authorizePath(clientId))
    expect(first.status).toBe(303)
    expect(first.headers.location).toBe("/signin")
    const signedIn = await browser.signIn("ada@example.com")
    expect(signedIn.headers.location).toBe("/oauth/continue")
    const page = await browser.get("/oauth/continue")
    expect(page.status).toBe(200)
    expect(page.text).toContain("Test &lt;script&gt;alert(1)&lt;/script&gt;")
    expect(page.text).not.toContain("<script>")
    expect(page.text).toContain("127.0.0.1:33418")
    const request = /name="request" value="([^"]+)"/.exec(page.text)?.[1] as string
    // Allow needs the form token.
    expect((await browser.post("/oauth/consent", { request, decision: "allow" })).status).toBe(403)
    const allowed = await browser.post("/oauth/consent", { form: formToken(page.text), request, decision: "allow" })
    const back = new URL(String(allowed.headers.location))
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT)
    expect(back.searchParams.get("state")).toBe("st-1")
    const code = back.searchParams.get("code") as string
    // A wrong verifier fails, and the code is used up by it.
    const exchange = (c: string, verifier: string) => tokenRequest(server as HubServer, { grant_type: "authorization_code", code: c, client_id: clientId, redirect_uri: REDIRECT, code_verifier: verifier })
    expect((await exchange(code, "w".repeat(60))).body.error).toBe("invalid_grant")
    expect((await exchange(code, VERIFIER)).body.error).toBe("invalid_grant")
    const code2 = await codeFor(browser, clientId)
    const tokens = await exchange(code2, VERIFIER)
    expect(tokens.status).toBe(200)
    expect(tokens.body.access_token).toMatch(/^cfa_/)
    expect(tokens.body.refresh_token).toMatch(/^cfr_/)
    expect(tokens.body.expires_in).toBe(3600)
    expect((await exchange(code2, VERIFIER)).body.error).toBe("invalid_grant")
    const agent = await connectAgent(server, tokens.body.access_token as string)
    expect((await call(agent, "list_projects")).isError).toBe(false)
    expect((await browser.get("/account")).text).toContain("Test &lt;script&gt;")
    // Refresh rotates; the old refresh token used again revokes the whole grant.
    const refresh = (r: string) => tokenRequest(server as HubServer, { grant_type: "refresh_token", refresh_token: r, client_id: clientId })
    const rotated = await refresh(tokens.body.refresh_token as string)
    expect(rotated.status).toBe(200)
    expect(rotated.body.refresh_token).not.toBe(tokens.body.refresh_token)
    expect((await refresh(tokens.body.refresh_token as string)).body.error).toBe("invalid_grant")
    expect((await refresh(rotated.body.refresh_token as string)).body.error).toBe("invalid_grant")
    await expect(call(agent, "list_projects")).rejects.toThrow()
    await agent.close().catch(() => undefined)
    // Revoke: a fresh grant's refresh token takes its access token with it.
    const third = await exchange(await codeFor(browser, clientId), VERIFIER)
    await send(server.url, "POST", "/oauth/revoke", { host: HOST, "content-type": "application/x-www-form-urlencoded" }, new URLSearchParams({ token: third.body.refresh_token as string, client_id: clientId }).toString())
    await expect(connectAgent(server, third.body.access_token as string)).rejects.toThrow()
    const events = server.hub.store.auditLog(100).map((e) => e.event)
    for (const event of ["client-registered", "consent-allowed", "grant-created", "token-refused", "token-refreshed", "refresh-reused-grant-revoked", "grant-revoked"]) expect(events).toContain(event)
    const log = JSON.stringify(server.hub.store.auditLog(100))
    for (const secret of [code, code2, tokens.body.access_token, tokens.body.refresh_token, rotated.body.access_token]) expect(log).not.toContain(secret)
  })

  test("Deny answers access_denied with the state", async () => {
    server = await startTestHub()
    const clientId = (await registerClient(server, { redirect_uris: [REDIRECT] })).body.client_id as string
    const browser = new Browser(server.url)
    await browser.signUp(invite(server), "ada@example.com")
    const page = await browser.get(authorizePath(clientId))
    const request = /name="request" value="([^"]+)"/.exec(page.text)?.[1] as string
    const denied = await browser.post("/oauth/consent", { form: formToken(page.text), request, decision: "deny" })
    const back = new URL(String(denied.headers.location))
    expect(back.searchParams.get("error")).toBe("access_denied")
    expect(back.searchParams.get("state")).toBe("st-1")
    expect(back.searchParams.get("code")).toBeNull()
  })

  test("redirect URI rules: http only on loopback, at most 5, exact match, and no open redirect through redirect_uri or state", async () => {
    server = await startTestHub()
    for (const uris of [["http://evil.example/cb"], ["javascript:alert(1)"], ["https://a.example/cb#x"], ["https://user:pw@a.example/cb"], [], Array.from({ length: 6 }, (_, i) => `https://a.example/${i}`)]) {
      expect((await registerClient(server, { redirect_uris: uris })).status, JSON.stringify(uris)).toBe(400)
    }
    expect((await registerClient(server, { redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "client_secret_basic" })).status).toBe(400)
    const clientId = (await registerClient(server, { redirect_uris: [REDIRECT, "https://app.example/cb"] })).body.client_id as string
    const browser = new Browser(server.url)
    await browser.signUp(invite(server), "ada@example.com")
    for (const uri of ["https://evil.example/cb", `${REDIRECT}/../x`, `${REDIRECT}?x=1`, "http://127.0.0.1:33418/Callback"]) {
      const answer = await browser.get(authorizePath(clientId, { redirect_uri: uri }))
      expect(answer.status, uri).toBe(400)
      expect(answer.headers.location, uri).toBeUndefined()
    }
    expect((await browser.get(authorizePath("0".repeat(32)))).status).toBe(400)
    // Errors after the URI is known go back to it; state is only a parameter there.
    const noPkce = await browser.get(authorizePath(clientId, { code_challenge_method: "plain", state: "https://evil.example/" }))
    const back = new URL(String(noPkce.headers.location))
    expect(back.host).toBe("127.0.0.1:33418")
    expect(back.searchParams.get("error")).toBe("invalid_request")
    expect(back.searchParams.get("state")).toBe("https://evil.example/")
  })
})
