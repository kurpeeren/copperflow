import { afterEach, describe, expect, test } from "vitest"
import { createHash } from "node:crypto"
import type { HubServer } from "../src/hub/server.js"
import { Browser, formToken, invite, ORIGIN, send, startTestHub } from "./helpers/hub-client.js"

const HOST = new URL(ORIGIN).host
const REDIRECT = "http://127.0.0.1:33418/callback"
const VERIFIER = "v".repeat(60)
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url")

let server: HubServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function register(hub: HubServer, from = "203.0.113.1", body: unknown = { redirect_uris: [REDIRECT] }) {
  const answer = await send(hub.url, "POST", "/oauth/register", { host: HOST, "content-type": "application/json", "x-forwarded-for": from }, JSON.stringify(body))
  return { status: answer.status, id: answer.status === 201 ? (JSON.parse(answer.text).client_id as string) : undefined, retryAfter: answer.headers["retry-after"] }
}

function authorizePath(clientId: string): string {
  return `/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: CHALLENGE, code_challenge_method: "S256", state: "s" })}`
}

describe("client registration under a flood", () => {
  test("a flood at the bucket's rate through the protection window still lets a new client register and authorise", async () => {
    let clock = Date.now()
    server = await startTestHub({ trustProxy: true, maxClients: 5, now: () => clock })
    const browser = new Browser(server.url)
    await browser.signUp(invite(server), "ada@example.com")
    const first = (await register(server, "203.0.113.9")).id as string
    const flood: string[] = []
    for (let i = 0; i < 4; i += 1) flood.push((await register(server, `198.51.100.${i}`)).id as string)
    // A table this small (5) holds less than the bucket admits in 10 minutes: within the protection window it is full.
    expect((await register(server, "198.51.100.200")).status).toBe(503)
    clock += 5 * 60_000
    // Ada starts authorising the first client: her pending request protects it from eviction.
    expect((await browser.get(authorizePath(first))).status).toBe(200)
    clock += 6 * 60_000
    const late = await register(server, "203.0.113.10")
    expect(late.status).toBe(201)
    expect(server.hub.store.tokens.client(first)).toBeDefined()
    expect(server.hub.store.tokens.client(flood[0] as string)).toBeUndefined()
    // The new client completes authorisation.
    const page = await browser.get(authorizePath(late.id as string))
    const request = /name="request" value="([^"]+)"/.exec(page.text)?.[1] as string
    const allowed = await browser.post("/oauth/consent", { form: formToken(page.text), request, decision: "allow" })
    const code = new URL(String(allowed.headers.location)).searchParams.get("code") as string
    const tokens = await send(server.url, "POST", "/oauth/token", { host: HOST, "content-type": "application/x-www-form-urlencoded" }, new URLSearchParams({ grant_type: "authorization_code", code, client_id: late.id as string, redirect_uri: REDIRECT, code_verifier: VERIFIER }).toString())
    expect(tokens.status).toBe(200)
  })

  test("a full address table refuses nobody; the global bucket answers 429 with Retry-After beyond its queue", async () => {
    server = await startTestHub({ trustProxy: true, limiterKeys: 2 })
    for (const from of ["192.0.2.1", "192.0.2.2", "192.0.2.3", "192.0.2.4"]) expect((await register(server, from)).status).toBe(201)
    const burst = await Promise.all(Array.from({ length: 8 }, () => register(server as HubServer, "192.0.2.50")))
    const refused = burst.filter((a) => a.status === 429)
    expect(refused.length).toBeGreaterThan(0)
    expect(refused[0]?.retryAfter).toBe("1")
  })

  test("a browser holds 3 pending authorisations, its 4th drops its own oldest, and another browser's stays", async () => {
    server = await startTestHub({ trustProxy: true })
    const clientId = (await register(server)).id as string
    const other = new Browser(server.url)
    await other.get(authorizePath(clientId))
    const theirs = other.jar.get("__Host-copperflow-oauth") as string
    const browser = new Browser(server.url)
    const mine: string[] = []
    for (let i = 0; i < 4; i += 1) {
      await browser.get(authorizePath(clientId))
      mine.push(browser.jar.get("__Host-copperflow-oauth") as string)
    }
    expect(browser.jar.get("__Host-copperflow-browser")).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(server.hub.oauth.request(mine[0], Date.now())).toBeUndefined()
    for (const secret of mine.slice(1)) expect(server.hub.oauth.request(secret, Date.now())).toBeDefined()
    expect(server.hub.oauth.request(theirs, Date.now())).toBeDefined()
  })

  test("one account looping register, authorise, allow and token never makes another person's registration fail", async () => {
    let clock = Date.now()
    server = await startTestHub({ trustProxy: true, maxClients: 12, now: () => clock })
    const browser = new Browser(server.url)
    await browser.signUp(invite(server), "ada@example.com")
    for (let i = 0; i < 15; i += 1) {
      const id = (await register(server, `198.51.100.${i}`)).id as string
      const page = await browser.get(authorizePath(id))
      const request = /name="request" value="([^"]+)"/.exec(page.text)?.[1] as string
      const allowed = await browser.post("/oauth/consent", { form: formToken(page.text), request, decision: "allow" })
      const code = new URL(String(allowed.headers.location)).searchParams.get("code") as string
      const tokens = await send(server.url, "POST", "/oauth/token", { host: HOST, "content-type": "application/x-www-form-urlencoded" }, new URLSearchParams({ grant_type: "authorization_code", code, client_id: id, redirect_uri: REDIRECT, code_verifier: VERIFIER }).toString())
      expect(tokens.status).toBe(200)
      clock += 60_000
    }
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    expect(server.hub.store.tokens.grants(userId)).toHaveLength(10)
    clock += 11 * 60_000
    expect((await register(server, "203.0.113.77")).status).toBe(201)
  })

  test("what is not a registration is refused before it counts", async () => {
    server = await startTestHub({ trustProxy: true })
    for (let i = 0; i < 25; i += 1) expect((await register(server, "192.0.2.7", {})).status).toBe(400)
    expect((await register(server, "192.0.2.7")).status).toBe(201)
  })
})
