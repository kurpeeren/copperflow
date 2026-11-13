import { afterEach, describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { parseServeArgs } from "../src/hub/commands.js"
import { DEFAULT_TLS_ASK_WEEKLY, TLS_BUDGET_TEXT, TLS_PER_USER, TLS_WINDOW_MS } from "../src/hub/project-origin.js"
import type { HubServer } from "../src/hub/server.js"
import { HubStore, SCHEMA_VERSION } from "../src/hub/store.js"
import { Browser, newUser, startTestHub } from "./helpers/hub-client.js"

let server: HubServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

const DAY = 24 * 60 * 60_000

async function projectsOf(browser: Browser, hub: HubServer, email: string, names: string[]): Promise<string[]> {
  for (const name of names) await browser.submit("/projects", "/projects", { name })
  const userId = hub.hub.store.userByEmail(email)?.id as string
  return hub.hub.store.projects(userId).map((project) => project.id)
}

const ask = (hub: HubServer, domain: string) => new Browser(hub.url).get(`/_tls-ask?domain=${encodeURIComponent(domain)}`)
const askProject = (hub: HubServer, id: string) => ask(hub, `${id}.ws.localhost`)

describe("the certificate budget for project names", () => {
  test("the numbers: 5 per user, 40 in the hub by default, 7 days", () => {
    expect(TLS_PER_USER).toBe(5)
    expect(DEFAULT_TLS_ASK_WEEKLY).toBe(40)
    expect(TLS_WINDOW_MS).toBe(7 * DAY)
    expect(SCHEMA_VERSION).toBe(4)
  })

  test("a user's sixth new project name in a week is refused while another user's first is approved; the public host is always answered", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const bob = await newUser(server, "bob@example.com")
    const mine = await projectsOf(ada, server, "ada@example.com", ["a1", "a2", "a3", "a4", "a5", "a6"])
    const theirs = await projectsOf(bob, server, "bob@example.com", ["b1"])
    for (const id of mine.slice(0, 5)) expect((await askProject(server, id)).status).toBe(200)
    expect((await askProject(server, mine[5] as string)).status).toBe(404)
    expect((await askProject(server, theirs[0] as string)).status).toBe(200)
    expect((await ask(server, "cf.example.test")).status).toBe(200)
    expect(server.hub.store.tlsNameKnown(mine[5] as string)).toBe(false)
  })

  test("renewals cost nothing: a name with a row is answered again with the budgets used up", async () => {
    server = await startTestHub({ tlsAskWeekly: 2 })
    const ada = await newUser(server, "ada@example.com")
    const ids = await projectsOf(ada, server, "ada@example.com", ["a1", "a2", "a3"])
    expect((await askProject(server, ids[0] as string)).status).toBe(200)
    expect((await askProject(server, ids[1] as string)).status).toBe(200)
    expect((await askProject(server, ids[2] as string)).status).toBe(404)
    for (let i = 0; i < 5; i += 1) expect((await askProject(server, ids[0] as string)).status).toBe(200)
  })

  test("the hub-wide budget: the nth+1 new name of any user is refused", async () => {
    server = await startTestHub({ tlsAskWeekly: 3 })
    const users = await Promise.all(["ada", "bob", "cy", "di"].map((name) => newUser(server as HubServer, `${name}@example.com`)))
    const ids: string[] = []
    for (const [index, name] of ["ada", "bob", "cy", "di"].entries()) ids.push(...(await projectsOf(users[index] as Browser, server, `${name}@example.com`, ["p"])))
    const answers = []
    for (const id of ids) answers.push((await askProject(server, id)).status)
    expect(answers).toEqual([200, 200, 200, 404])
  })

  test("after a week the budget is free again", async () => {
    let now = Date.now()
    server = await startTestHub({ tlsAskWeekly: 1, now: () => now })
    const ada = await newUser(server, "ada@example.com")
    const ids = await projectsOf(ada, server, "ada@example.com", ["a1", "a2"])
    expect((await askProject(server, ids[0] as string)).status).toBe(200)
    expect((await askProject(server, ids[1] as string)).status).toBe(404)
    now += 7 * DAY + 1000
    expect((await askProject(server, ids[1] as string)).status).toBe(200)
  })

  test("deleted projects still count against the user who made them", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    const first = await projectsOf(ada, server, "ada@example.com", ["a1", "a2", "a3", "a4", "a5"])
    for (const id of first) {
      expect((await askProject(server, id)).status).toBe(200)
      server.hub.store.deleteProject(userId, id)
    }
    const [sixth] = await projectsOf(ada, server, "ada@example.com", ["a6"])
    expect((await askProject(server, sixth as string)).status).toBe(404)
    // A deleted project's own name is no longer answered.
    expect((await askProject(server, first[0] as string)).status).toBe(404)
  })

  test("--tls-ask-weekly 0 approves no new project name", async () => {
    server = await startTestHub({ tlsAskWeekly: 0 })
    const ada = await newUser(server, "ada@example.com")
    const ids = await projectsOf(ada, server, "ada@example.com", ["a1"])
    expect((await askProject(server, ids[0] as string)).status).toBe(404)
    expect((await ask(server, "cf.example.test")).status).toBe(200)
  })

  test("the owner sees the 503 page when a budget is used up and some name was approved; no page when no row exists at all", async () => {
    server = await startTestHub({ tlsAskWeekly: 1 })
    const ada = await newUser(server, "ada@example.com")
    const ids = await projectsOf(ada, server, "ada@example.com", ["a1", "a2"])
    // No row anywhere (a wildcard deployment never asks): the redirect, never the page.
    expect(server.hub.store.tlsNamesExist()).toBe(false)
    expect((await ada.get(`/p/${ids[1] as string}/`)).status).toBe(303)
    expect((await askProject(server, ids[0] as string)).status).toBe(200)
    const refused = await ada.get(`/p/${ids[1] as string}/`)
    expect(refused.status).toBe(503)
    expect(refused.text).toBe(TLS_BUDGET_TEXT)
    expect(String(refused.headers["content-type"])).toContain("text/plain")
    // A project with a row is still handed over.
    expect((await ada.get(`/p/${ids[0] as string}/`)).status).toBe(303)
  })
})

describe("the sweep and the schema", () => {
  test("rows older than a week whose project is gone are pruned; the others stay", async () => {
    let now = Date.now()
    server = await startTestHub({ now: () => now, sweepMs: 20 })
    const ada = await newUser(server, "ada@example.com")
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    const ids = await projectsOf(ada, server, "ada@example.com", ["a1", "a2", "a3"])
    for (const id of ids) expect((await askProject(server, id)).status).toBe(200)
    server.hub.store.deleteProject(userId, ids[0] as string)
    now += 8 * DAY
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && server.hub.store.tlsNameKnown(ids[0] as string)) await new Promise((r) => setTimeout(r, 25))
    expect(server.hub.store.tlsNameKnown(ids[0] as string)).toBe(false)
    expect(server.hub.store.tlsNameKnown(ids[1] as string)).toBe(true)
  })

  test("a row younger than a week is kept even when its project is gone", async () => {
    let now = Date.now()
    server = await startTestHub({ now: () => now, sweepMs: 20 })
    const ada = await newUser(server, "ada@example.com")
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    const [id] = await projectsOf(ada, server, "ada@example.com", ["a1"])
    expect((await askProject(server, id as string)).status).toBe(200)
    server.hub.store.deleteProject(userId, id as string)
    now += 6 * DAY
    await new Promise((r) => setTimeout(r, 200))
    expect(server.hub.store.tlsNameKnown(id as string)).toBe(true)
  })

  test("a version 2 database gets the table at open, with its data kept", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-tls-schema-"))
    const file = join(dir, "hub.db")
    HubStore.open(file).close()
    const db = new DatabaseSync(file)
    db.exec("DROP TABLE tls_names; PRAGMA user_version = 2")
    db.close()
    const store = HubStore.open(file)
    expect(store.tlsNamesExist()).toBe(false)
    expect(store.tlsApprove("a".repeat(32), "u1", 1, TLS_WINDOW_MS, 5, 40)).toBe("approved")
    store.close()
    const check = new DatabaseSync(file, { readOnly: true })
    expect(Number((check.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)).toBe(4)
    check.close()
  })
})

describe("the option", () => {
  const base = ["--data", "/var/lib/copperflow", "--port", "8780", "--public-origin", "https://x.example.com", "--workspace-domain", "ws.x.example.com", "--trusted-accounts-only"]

  test("--tls-ask-weekly defaults to 40, takes a whole number, and refuses anything else", () => {
    expect(parseServeArgs(base, "/").tlsAskWeekly).toBe(40)
    expect(parseServeArgs([...base, "--tls-ask-weekly", "0"], "/").tlsAskWeekly).toBe(0)
    expect(parseServeArgs([...base, "--tls-ask-weekly", "25"], "/").tlsAskWeekly).toBe(25)
    for (const bad of ["abc", "-1", "1.5", "", "99999"]) expect(() => parseServeArgs([...base, "--tls-ask-weekly", bad], "/"), bad).toThrow(/--tls-ask-weekly/)
  })
})
