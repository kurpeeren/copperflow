// Every path that revokes a user's access, walked one by one, with every kind of credential checked afterwards, so a
// new path cannot forget one. A plain sign-out is the one path that leaves agent credentials alone.
import { afterEach, describe, expect, test } from "vitest"
import { createHash } from "node:crypto"
import { request } from "node:http"
import { join } from "node:path"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { runCli } from "../src/cli-commands.js"
import { newToken, PAT_PREFIX } from "../src/hub/agent-tokens.js"
import { hashSecret, newId } from "../src/hub/secrets.js"
import type { HubServer } from "../src/hub/server.js"
import { Browser, fixedRunner, formToken, newUser, ORIGIN, send, startTestHub } from "./helpers/hub-client.js"
import { call, connectAgent } from "./helpers/hub-mcp.js"

let server: HubServer | undefined
const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined)
  await server?.close()
  server = undefined
})

interface Held {
  browser: Browser
  userId: string
  projectId: string | undefined
  pat: string
  access: string
  refresh: string
  clientId: string
  agent: Client
  oauthAgent: Client
}

const HOST = new URL(ORIGIN).host
const REDIRECT = "http://127.0.0.1:33418/callback"
const VERIFIER = "v".repeat(60)
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url")

/** Gives the user one of each credential: hub session, device, workspace session, PAT, access and refresh token, agent session. */
async function holdEverything(hub: HubServer, browser: Browser, email: string, enter = true): Promise<Held> {
  const userId = hub.hub.store.userByEmail(email)?.id as string
  let projectId: string | undefined
  if (enter) {
    await browser.submit("/projects", "/projects", { name: `P${Math.random()}` })
    projectId = hub.hub.store.projects(userId)[0]?.id as string
    await browser.openProject(projectId)
  }
  const pat = newToken(PAT_PREFIX)
  hub.hub.store.tokens.addPersonalToken({ id: newId(), hash: hashSecret(pat), userId, name: "t" }, 10, Date.now())
  // OAuth tokens through the real flow: registration, authorise, consent, code exchange.
  const registered = await send(hub.url, "POST", "/oauth/register", { host: HOST, "content-type": "application/json" }, JSON.stringify({ redirect_uris: [REDIRECT] }))
  const clientId = JSON.parse(registered.text).client_id as string
  const page = await browser.get(`/oauth/authorize?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: CHALLENGE, code_challenge_method: "S256" })}`)
  const request = /name="request" value="([^"]+)"/.exec(page.text)?.[1] as string
  const allowed = await browser.post("/oauth/consent", { form: formToken(page.text), request, decision: "allow" })
  const code = new URL(String(allowed.headers.location)).searchParams.get("code") as string
  const tokens = JSON.parse((await form(hub, "/oauth/token", { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: REDIRECT, code_verifier: VERIFIER })).text) as Record<string, string>
  const agent = await connectAgent(hub, pat, { ownStream: false })
  const oauthAgent = await connectAgent(hub, tokens.access_token as string, { ownStream: false })
  clients.push(agent, oauthAgent)
  expect((await call(agent, "list_projects")).isError).toBe(false)
  expect((await call(oauthAgent, "list_projects")).isError).toBe(false)
  return { browser, userId, projectId, pat, access: tokens.access_token as string, refresh: tokens.refresh_token as string, clientId, agent, oauthAgent }
}

function form(hub: HubServer, path: string, fields: Record<string, string>) {
  return send(hub.url, "POST", path, { host: HOST, "content-type": "application/x-www-form-urlencoded" }, new URLSearchParams(fields).toString())
}

async function until(check: () => Promise<boolean> | boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return
    await new Promise((done) => setTimeout(done, 20))
  }
}

/** Opens the agent session's GET stream with `token`; `ended` settles when the hub ends it. */
function openStream(hub: HubServer, agent: Client, token: string): Promise<{ ended: Promise<void>; isEnded: () => boolean }> {
  const sessionId = (agent.transport as StreamableHTTPClientTransport).sessionId as string
  const port = Number(new URL(hub.url).port)
  return new Promise((ready, fail) => {
    const req = request({ host: "127.0.0.1", port, method: "GET", path: "/mcp", agent: false, headers: { host: HOST, authorization: `Bearer ${token}`, "mcp-session-id": sessionId, accept: "text/event-stream", "mcp-protocol-version": "2025-06-18" } }, (res) => {
      if (res.statusCode !== 200) return fail(new Error(`stream refused: ${res.statusCode}`))
      let ended = false
      const done = new Promise<void>((settle) => {
        const finish = () => {
          ended = true
          settle()
        }
        res.on("end", finish)
        res.on("close", finish)
        res.on("error", finish)
      })
      res.resume()
      ready({ ended: done, isEnded: () => ended })
    })
    req.on("error", fail)
    req.end()
  })
}

async function agentAlive(agent: Client): Promise<boolean> {
  try {
    return !(await call(agent, "list_projects")).isError
  } catch {
    return false
  }
}

async function cli(hub: HubServer, args: string[], ask?: string): Promise<string[]> {
  const out: string[] = []
  const data = join(hub.hub.files.root, "..")
  const code = await runCli(["hub", ...args, "--data", data], "/", { out: (line: string) => out.push(line), err: () => undefined, ...(ask ? { ask: async () => ask } : {}) })
  expect(code).toBe(0)
  return out
}

type Path = { name: string; revokesAgents: boolean; run: (hub: HubServer, held: Held) => Promise<void> }

const PATHS: Path[] = [
  { name: "change password", revokesAgents: true, run: async (_, h) => void (await h.browser.submit("/account", "/account/password", { current: "a good password", password: "another good password" })) },
  { name: "end all sessions", revokesAgents: true, run: async (_, h) => void (await h.browser.submit("/account", "/account/end-sessions", {})) },
  { name: "delete account", revokesAgents: true, run: async (_, h) => void (await h.browser.submit("/account", "/account/delete", { confirm: "ada@example.com", password: "a good password" })) },
  { name: "maintainer reset-password", revokesAgents: true, run: async (hub) => void (await cli(hub, ["reset-password", "ada@example.com"])) },
  { name: "maintainer delete-user", revokesAgents: true, run: async (hub) => void (await cli(hub, ["delete-user", "ada@example.com"], "ada@example.com")) },
  { name: "plain sign-out", revokesAgents: false, run: async (_, h) => void (await h.browser.submit("/projects", "/signout", {})) },
]

describe("revocation", () => {
  for (const path of PATHS) {
    test(`${path.name}: every credential kind afterwards`, async () => {
      server = await startTestHub({ runner: () => fixedRunner(() => "http://127.0.0.1:9"), sweepMs: 50 })
      const browser = await newUser(server, "ada@example.com")
      await browser.signIn("ada@example.com")
      const held = await holdEverything(server, browser, "ada@example.com")
      const oldCookies = new Map(browser.jar)
      const streams = [await openStream(server, held.agent, held.pat), await openStream(server, held.oauthAgent, held.access)]
      expect(server.hub.agents.size).toBe(2)
      await path.run(server, held)
      if (path.revokesAgents) {
        // The sessions are closed and their open streams ended, not merely refused at the next request.
        await Promise.race([Promise.all(streams.map((s) => s.ended)), new Promise((done) => setTimeout(done, 3000))])
        expect(streams.map((s) => s.isEnded()), `${path.name}: open streams`).toEqual([true, true])
        expect(server.hub.agents.size, `${path.name}: agent sessions`).toBe(0)
      } else {
        await new Promise((done) => setTimeout(done, 200))
        expect(streams.map((s) => s.isEnded()), `${path.name}: open streams`).toEqual([false, false])
        expect(server.hub.agents.size, `${path.name}: agent sessions`).toBe(2)
      }
      const now = Date.now()
      const tokens = server.hub.store.tokens
      if (path.revokesAgents) await until(async () => !(await agentAlive(held.agent)))
      // Hub session and workspace session of this browser: gone on every path.
      const stale = new Browser(server.url)
      for (const [name, value] of oldCookies) stale.jar.set(name, value)
      expect((await stale.get("/projects")).headers.location, path.name).toBe("/signin")
      expect((await stale.onProject(held.projectId as string, "GET", "/api/circuits")).status, path.name).toBe(404)
      expect(tokens.credential(hashSecret(held.pat), now) !== undefined, `${path.name}: personal token`).toBe(!path.revokesAgents)
      expect(tokens.credential(hashSecret(held.access), now) !== undefined, `${path.name}: access token`).toBe(!path.revokesAgents)
      expect(await agentAlive(held.agent), `${path.name}: agent session (personal token)`).toBe(!path.revokesAgents)
      expect(await agentAlive(held.oauthAgent), `${path.name}: agent session (OAuth access token)`).toBe(!path.revokesAgents)
      // The refresh token, used for real at the token endpoint.
      const refreshed = await form(server, "/oauth/token", { grant_type: "refresh_token", refresh_token: held.refresh, client_id: held.clientId })
      expect(refreshed.status, `${path.name}: refresh token`).toBe(path.revokesAgents ? 400 : 200)
      if (path.revokesAgents) expect(server.hub.store.deviceCount(held.userId), `${path.name}: devices`).toBe(0)
    })
  }

  test("the forced change after a reset revokes credentials made since", async () => {
    server = await startTestHub({ runner: () => fixedRunner(() => "http://127.0.0.1:9"), sweepMs: 50 })
    await newUser(server, "ada@example.com")
    const out = await cli(server, ["reset-password", "ada@example.com"])
    const browser = new Browser(server.url)
    await browser.signIn("ada@example.com", out[out.length - 1] as string)
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    const pat = newToken(PAT_PREFIX)
    server.hub.store.tokens.addPersonalToken({ id: newId(), hash: hashSecret(pat), userId, name: "t" }, 10, Date.now())
    const page = await browser.get("/account")
    await browser.post("/account/password", { form: formToken(page.text), current: out[out.length - 1] as string, password: "another good password" })
    expect(server.hub.store.tokens.credential(hashSecret(pat), Date.now())).toBeUndefined()
    expect(server.hub.store.deviceCount(userId)).toBe(0)
  })
})
