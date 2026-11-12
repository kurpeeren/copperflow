// Every path that revokes a user's access, walked one by one, with every kind of credential checked afterwards, so a
// new path cannot forget one. A plain sign-out is the one path that leaves agent credentials alone.
import { afterEach, describe, expect, test } from "vitest"
import { join } from "node:path"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { runCli } from "../src/cli-commands.js"
import { ACCESS_PREFIX, newToken, PAT_PREFIX, REFRESH_PREFIX } from "../src/hub/agent-tokens.js"
import { hashSecret, newId } from "../src/hub/secrets.js"
import type { HubServer } from "../src/hub/server.js"
import { Browser, fixedRunner, formToken, newUser, startTestHub } from "./helpers/hub-client.js"
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
  agent: Client
}

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
  const clientId = newId()
  const grantId = newId()
  hub.hub.store.tokens.addClient({ id: clientId, name: "c", redirectUris: [] }, 100, Date.now())
  hub.hub.store.tokens.createGrant({ id: grantId, userId, clientId }, Date.now())
  const access = newToken(ACCESS_PREFIX)
  const refresh = newToken(REFRESH_PREFIX)
  hub.hub.store.tokens.issue({ hash: hashSecret(access), grantId, userId, kind: "access", expires: Date.now() + 3_600_000 })
  hub.hub.store.tokens.issue({ hash: hashSecret(refresh), grantId, userId, kind: "refresh", expires: Date.now() + 3_600_000 })
  const agent = await connectAgent(hub, pat)
  clients.push(agent)
  expect((await call(agent, "list_projects")).isError).toBe(false)
  return { browser, userId, projectId, pat, access, refresh, agent }
}

async function until(check: () => Promise<boolean> | boolean): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    if (await check()) return
    await new Promise((done) => setTimeout(done, 20))
  }
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
      await path.run(server, held)
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
      const refreshLive = tokens.credentialLive(`grant:${[...tokens.grants(held.userId)].map((g) => g.id)[0] ?? "none"}`)
      expect(refreshLive, `${path.name}: refresh token`).toBe(!path.revokesAgents)
      expect(await agentAlive(held.agent), `${path.name}: agent session`).toBe(!path.revokesAgents)
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
