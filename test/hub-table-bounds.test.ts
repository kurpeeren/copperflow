import { afterEach, describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { DatabaseSync } from "node:sqlite"
import { runCli } from "../src/cli-commands.js"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AUDIT_KEEP_MS, AUDIT_MAX_ROWS, pruneAudit, ROUTINE_AUDIT_KINDS } from "../src/hub/audit-prune.js"
import { HubStore, MAX_SESSIONS_PER_USER, MAX_WORKSPACE_SESSIONS } from "../src/hub/store.js"
import type { HubServer } from "../src/hub/server.js"
import { newUser, startTestHub } from "./helpers/hub-client.js"
import { call, connectAgent } from "./helpers/hub-mcp.js"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Browser } from "./helpers/hub-client.js"

let store: HubStore | undefined
let server: HubServer | undefined
const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined)
  store?.close()
  store = undefined
  await server?.close()
  server = undefined
})

async function openStore(): Promise<HubStore> {
  store = HubStore.open(join(await mkdtemp(join(tmpdir(), "cf-bounds-")), "hub.db"))
  return store
}

/** A user with one project, as rows. */
function seed(s: HubStore, userId = "u1"): void {
  s.addInvite(`invite-${userId}`, 0)
  s.signUp(`invite-${userId}`, { id: userId, email: `${userId}@example.com`, passwordHash: "h" }, 0)
  s.createProject({ id: `p-${userId}`, userId, name: "Amp", created: 0 })
}

describe("sign-in sessions and workspace sessions are capped", () => {
  test("the limits are 20 sessions per user and 8 workspace sessions per user and project", () => {
    expect(MAX_SESSIONS_PER_USER).toBe(20)
    expect(MAX_WORKSPACE_SESSIONS).toBe(8)
  })

  test("a twenty-first session ends that user's oldest and nobody else's", async () => {
    const s = await openStore()
    seed(s, "u1")
    seed(s, "u2")
    s.createSession("other", "u2", 1, 1_000_000)
    for (let i = 0; i < 21; i += 1) s.createSession(`s${i}`, "u1", 10 + i, 1_000_000)
    expect(s.sessionCount("u1")).toBe(20)
    expect(s.session("s0", 100)).toBeUndefined()
    expect(s.session("s1", 100)?.userId).toBe("u1")
    expect(s.session("s20", 100)?.userId).toBe("u1")
    expect(s.session("other", 100)?.userId).toBe("u2")
  })

  test("ending a session takes its workspace sessions with it", async () => {
    const s = await openStore()
    seed(s)
    for (let i = 0; i < 20; i += 1) s.createSession(`s${i}`, "u1", 10 + i, 1_000_000)
    s.createWorkspaceSession("w-old", "u1", "p-u1", "s0", 1_000_000)
    s.createSession("s20", "u1", 40, 1_000_000)
    expect(s.workspaceSession("w-old", 100)).toBeUndefined()
  })

  test("a ninth workspace session of one project ends that user's oldest for that project only", async () => {
    const s = await openStore()
    seed(s, "u1")
    seed(s, "u2")
    s.createProject({ id: "p2-u1", userId: "u1", name: "Second", created: 0 })
    s.createSession("h1", "u1", 1, 1_000_000)
    s.createSession("h2", "u2", 1, 1_000_000)
    s.createWorkspaceSession("keep-other-project", "u1", "p2-u1", "h1", 1_000_000)
    s.createWorkspaceSession("keep-other-user", "u2", "p-u2", "h2", 1_000_000)
    for (let i = 0; i < 9; i += 1) s.createWorkspaceSession(`w${i}`, "u1", "p-u1", "h1", 1_000_000)
    expect(s.workspaceSessionCount("u1", "p-u1")).toBe(8)
    expect(s.workspaceSession("w0", 100)).toBeUndefined()
    expect(s.workspaceSession("w1", 100)?.projectId).toBe("p-u1")
    expect(s.workspaceSession("w8", 100)?.projectId).toBe("p-u1")
    expect(s.workspaceSession("keep-other-project", 100)).toBeDefined()
    expect(s.workspaceSession("keep-other-user", 100)).toBeDefined()
  })

  test("sweepWorkspaceSessions deletes the expired ones and keeps the live", async () => {
    const s = await openStore()
    seed(s)
    s.createSession("h1", "u1", 1, 1_000_000)
    s.createWorkspaceSession("dead", "u1", "p-u1", "h1", 500)
    s.createWorkspaceSession("live", "u1", "p-u1", "h1", 5_000)
    expect(s.sweepWorkspaceSessions(1_000)).toBe(1)
    expect(s.workspaceSessionCount("u1", "p-u1")).toBe(1)
    expect(s.workspaceSession("live", 1_000)).toBeDefined()
  })
})

describe("the audit log is pruned", () => {
  const DAY = 24 * 60 * 60_000

  test("the rules are 180 days and 500 000 rows", () => {
    expect(AUDIT_KEEP_MS).toBe(180 * DAY)
    expect(AUDIT_MAX_ROWS).toBe(500_000)
  })

  test("pruneAudit loops over batches and yields between them, up to a bound per sweep", async () => {
    const s = await openStore()
    const now = 1_000 * DAY
    for (let i = 0; i < 50; i += 1) s.audit({ time: now - 300 * DAY + i, userId: null, event: "old", address: `a${i}`, detail: "" })
    expect(await pruneAudit(s, now, { batch: 10, maxBatches: 3 })).toBe(30)
    expect(s.auditLog(100)).toHaveLength(20)
    expect(await pruneAudit(s, now, { batch: 10, maxBatches: 3 })).toBe(20)
    expect(s.auditLog(100)).toHaveLength(0)
  })
})

describe("the hub's sweep calls the prunes", () => {
  test("expired workspace sessions and old audit rows go at the next sweep", async () => {
    let now = Date.now()
    server = await startTestHub({ now: () => now, sweepMs: 20 })
    const ada = await newUser(server, "ada@example.com")
    await ada.submit("/projects", "/projects", { name: "Amp" })
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    const id = server.hub.store.projects(userId)[0]?.id as string
    const { entered } = await ada.openProject(id)
    expect(entered?.status).toBe(303)
    expect(server.hub.store.workspaceSessionCount(userId, id)).toBe(1)
    const until = async (done: () => boolean) => {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline && !done()) await new Promise((r) => setTimeout(r, 25))
    }
    // 13 hours on: the workspace session (12 h) is expired, the hub session (14 days) still lives.
    now += 13 * 60 * 60_000
    await until(() => server?.hub.store.workspaceSessionCount(userId, id) === 0)
    expect(server.hub.store.workspaceSessionCount(userId, id)).toBe(0)
    // Recent audit rows stay.
    expect(server.hub.store.auditLog(1000).some((e) => e.event === "signup")).toBe(true)
    // 181 days on: everything written so far is past the retention.
    now += 181 * 24 * 60 * 60_000
    await until(() => server?.hub.store.auditLog(1000).some((e) => e.event === "signup") === false)
    expect(server.hub.store.auditLog(1000).some((e) => e.event === "signup")).toBe(false)
    expect(server.hub.store.auditLog(1000)).toHaveLength(0)
  })
})

async function agentOf(hub: HubServer, browser: Browser): Promise<Client> {
  const made = await browser.submit("/account", "/account/tokens", { name: "agent", password: "a good password" })
  const token = /cfp_[A-Za-z0-9_-]{43}/.exec(made.text)?.[0] as string
  const client = await connectAgent(hub, token)
  clients.push(client)
  return client
}

describe("the audit log by count", () => {
  const DAY = 24 * 60 * 60_000
  const R = ROUTINE_AUDIT_KINDS

  test("rows older than the retention go, whatever their kind, in batches", async () => {
    const s = await openStore()
    const now = 1_000 * DAY
    for (let i = 0; i < 25; i += 1) s.audit({ time: now - 200 * DAY + i, userId: null, event: i % 2 ? "signin" : "workspace-entered", address: "a", detail: "" })
    for (let i = 0; i < 5; i += 1) s.audit({ time: now - 10 * DAY + i, userId: null, event: "new", address: "a", detail: "" })
    expect(s.pruneAuditBatch(now - AUDIT_KEEP_MS, AUDIT_MAX_ROWS, 10, R)).toBe(10)
    expect(s.pruneAuditBatch(now - AUDIT_KEEP_MS, AUDIT_MAX_ROWS, 10, R)).toBe(10)
    expect(s.pruneAuditBatch(now - AUDIT_KEEP_MS, AUDIT_MAX_ROWS, 10, R)).toBe(5)
    expect(s.pruneAuditBatch(now - AUDIT_KEEP_MS, AUDIT_MAX_ROWS, 10, R)).toBe(0)
    expect(s.auditLog(100).map((e) => e.event)).toEqual(["new", "new", "new", "new", "new"])
  })

  test("over the row cap only routine rows go, oldest first; security rows stay", async () => {
    const s = await openStore()
    const now = 1_000 * DAY
    for (let i = 0; i < 12; i += 1) s.audit({ time: now, userId: "u", event: "signin", address: "a", detail: `s${i}` })
    for (let i = 0; i < 18; i += 1) s.audit({ time: now, userId: "u", event: "workspace-entered", address: "a", detail: `r${i}` })
    expect(s.pruneAuditBatch(0, 20, 4, R)).toBe(4)
    expect(s.pruneAuditBatch(0, 20, 4, R)).toBe(4)
    expect(s.pruneAuditBatch(0, 20, 4, R)).toBe(2)
    expect(s.pruneAuditBatch(0, 20, 4, R)).toBe(0)
    const left = s.auditLog(100)
    expect(left).toHaveLength(20)
    expect(left.filter((e) => e.event === "signin")).toHaveLength(12)
    const routine = left.filter((e) => e.event === "workspace-entered").map((e) => e.detail)
    expect(routine).not.toContain("r0")
    expect(routine).toContain("r17")
  })

  test("a log of only security rows above the cap loses nothing and says it is over", async () => {
    const s = await openStore()
    for (let i = 0; i < 30; i += 1) s.audit({ time: 5, userId: null, event: i % 2 ? "signin" : "token-created", address: "a", detail: "" })
    expect(s.auditOverCap(20)).toBe(true)
    expect(s.pruneAuditBatch(0, 20, 100, R)).toBe(0)
    expect(s.auditRowCount()).toBe(30)
    expect(s.auditOverCap(30)).toBe(false)
  })

  test("the class of a kind is one explicit list; anything not on it is security", () => {
    expect([...R].sort()).toEqual(["tool-calls-limited", "workspace-entered"])
  })

  test("a user who writes 600 000 routine rows cannot remove another user's sign-in row", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-flood-"))
    const file = join(dir, "hub.db")
    const s = HubStore.open(file)
    store = s
    const now = 1_000 * DAY
    s.audit({ time: now, userId: "bob", event: "signin", address: "b", detail: "bobs row" })
    const raw = new DatabaseSync(file)
    raw.exec(`WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 600000) INSERT INTO audit (time, user_id, event, address, detail) SELECT ${now}, 'mallory', 'workspace-entered', 'm', '' FROM c`)
    raw.close()
    expect(s.auditRowCount()).toBe(600_001)
    let rounds = 0
    while ((await pruneAudit(s, now)) > 0 && rounds < 20) rounds += 1
    expect(s.auditRowCount()).toBe(AUDIT_MAX_ROWS)
    expect(s.auditLog(AUDIT_MAX_ROWS).some((e) => e.detail === "bobs row")).toBe(true)
  }, 120_000)

  test("hub status reports the row count and the over-cap flag, in text and in JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-status-"))
    const file = join(dir, "hub.db")
    HubStore.open(file).close()
    const raw = new DatabaseSync(file)
    raw.exec(`WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < ${AUDIT_MAX_ROWS + 1}) INSERT INTO audit (time, user_id, event, address, detail) SELECT 1, NULL, 'signin', 'a', '' FROM c`)
    raw.close()
    const lines: string[] = []
    const out = { out: (t: string) => lines.push(t), err: () => undefined }
    expect(await runCli(["hub", "status", "--data", dir, "--json"], "/", out)).toBe(0)
    const report = JSON.parse(lines[0] as string) as { auditRows: number; auditOverCap: boolean }
    expect(report.auditRows).toBe(AUDIT_MAX_ROWS + 1)
    expect(report.auditOverCap).toBe(true)
    lines.length = 0
    expect(await runCli(["hub", "status", "--data", dir], "/", out)).toBe(0)
    expect(lines.find((l) => l.startsWith("Audit log rows:"))).toContain("over the 500000 cap")
  }, 120_000)
})
