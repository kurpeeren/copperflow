import { afterEach, describe, expect, test, vi } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { AUDIT_FULL_ROWS_PER_KEY, AUDIT_FULL_ROWS_PER_KIND, AUDIT_MAX_KEYS, AUDIT_WINDOW_MS, AuditGate } from "../src/hub/audit-gate.js"
import { COUNT_CHECK_EVERY_MS, pruneAudit } from "../src/hub/audit-prune.js"
import type { HubServer } from "../src/hub/server.js"
import { HubStore, ROUTINE_PRUNE_SQL } from "../src/hub/store.js"
import { Browser, newUser, send, startTestHub } from "./helpers/hub-client.js"

let store: HubStore | undefined
let server: HubServer | undefined
afterEach(async () => {
  store?.close()
  store = undefined
  await server?.close()
  server = undefined
})

async function fileOf(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "cf-gate-")), "hub.db")
}

async function open(options: { gate?: AuditGate } = {}): Promise<HubStore> {
  store = HubStore.open(await fileOf(), options)
  return store
}

const T0 = 1_000_000_000_000
const rowsOf = (s: HubStore, event: string) => s.auditLog(1_000_000).filter((row) => row.event === event)

describe("the audit rule", () => {
  test("the numbers: 20 per key, 15 minutes, 5 000 per kind, 100 000 keys", () => {
    expect(AUDIT_FULL_ROWS_PER_KEY).toBe(20)
    expect(AUDIT_WINDOW_MS).toBe(15 * 60_000)
    expect(AUDIT_FULL_ROWS_PER_KIND).toBe(5_000)
    expect(AUDIT_MAX_KEYS).toBe(100_000)
  })

  test("one address causing 1 000 refused sign-ins writes 22 rows, and the count row says 980", async () => {
    const s = await open()
    for (let i = 0; i < 1000; i += 1) s.audit({ time: T0 + i, userId: null, event: "signin-limited-address", address: "203.0.113.9", detail: "" })
    expect(s.flushAuditCounts(T0 + 1000)).toBe(0)
    expect(s.flushAuditCounts(T0 + AUDIT_WINDOW_MS + 1)).toBe(1)
    const all = s.auditLog(1000)
    expect(all).toHaveLength(22)
    expect(all.filter((row) => row.event === "signin-limited-address")).toHaveLength(20)
    const summarised = rowsOf(s, "audit-summarised")
    expect(summarised).toHaveLength(1)
    expect(summarised[0]?.detail).toBe("kind=signin-limited-address actor=203.0.113.9")
    const count = rowsOf(s, "audit-count")
    expect(count).toHaveLength(1)
    expect(count[0]?.detail).toContain("kind=signin-limited-address actor=203.0.113.9 n=980 ")
    // Flushed once; nothing pending any more.
    expect(s.flushAuditCounts(T0 + 2 * AUDIT_WINDOW_MS, true)).toBe(0)
  })

  test("a user's 21st project-renamed in a window is a summary row carrying their id", async () => {
    const s = await open()
    for (let i = 0; i < 25; i += 1) s.audit({ time: T0 + i, userId: "user-a", event: "project-renamed", address: "198.51.100.1", detail: `p${i}` })
    expect(rowsOf(s, "project-renamed")).toHaveLength(20)
    const summarised = rowsOf(s, "audit-summarised")
    expect(summarised).toHaveLength(1)
    expect(summarised[0]?.userId).toBe("user-a")
    expect(summarised[0]?.detail).toBe("kind=project-renamed actor=user-a")
    s.flushAuditCounts(T0 + AUDIT_WINDOW_MS + 1)
    const count = rowsOf(s, "audit-count")
    expect(count[0]?.userId).toBe("user-a")
    expect(count[0]?.detail).toContain("n=5 ")
  })

  test("a new window writes in full again, and a late event flushes the old window's count first", async () => {
    const s = await open()
    for (let i = 0; i < 30; i += 1) s.audit({ time: T0 + i, userId: "user-a", event: "project-renamed", address: "a", detail: "" })
    s.audit({ time: T0 + AUDIT_WINDOW_MS + 5, userId: "user-a", event: "project-renamed", address: "a", detail: "new" })
    expect(rowsOf(s, "project-renamed")).toHaveLength(21)
    expect(rowsOf(s, "audit-count")[0]?.detail).toContain("n=10 ")
  })

  test("two users' rows never merge, and one actor's flood leaves another actor's rows in full", async () => {
    const s = await open()
    for (let i = 0; i < 500; i += 1) s.audit({ time: T0 + i, userId: "flooder", event: "project-renamed", address: "a", detail: "" })
    for (let i = 0; i < 5; i += 1) s.audit({ time: T0 + i, userId: "quiet", event: "project-renamed", address: "b", detail: `q${i}` })
    expect(rowsOf(s, "project-renamed").filter((row) => row.userId === "quiet")).toHaveLength(5)
    s.flushAuditCounts(T0 + AUDIT_WINDOW_MS + 1)
    const counts = rowsOf(s, "audit-count")
    expect(counts).toHaveLength(1)
    expect(counts[0]?.userId).toBe("flooder")
  })

  test("past 5 000 full rows of a kind, address actors are counted under many while a user's row is still written in full", async () => {
    const s = await open()
    for (let i = 0; i < AUDIT_FULL_ROWS_PER_KIND + 300; i += 1) s.audit({ time: T0 + i, userId: null, event: "signin-limited-address", address: `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`, detail: "" })
    expect(rowsOf(s, "signin-limited-address")).toHaveLength(AUDIT_FULL_ROWS_PER_KIND)
    s.audit({ time: T0 + 400, userId: "user-a", event: "signin-limited-address", address: "198.51.100.7", detail: "user" })
    expect(rowsOf(s, "signin-limited-address").some((row) => row.detail === "user")).toBe(true)
    s.flushAuditCounts(T0 + 2 * AUDIT_WINDOW_MS)
    const count = rowsOf(s, "audit-count").filter((row) => row.detail.includes("actor=many"))
    expect(count).toHaveLength(1)
    expect(count[0]?.detail).toContain("n=300 ")
    expect(count[0]?.address).toBe("many")
  }, 60_000)

  test("when the key table is full a new key is counted under many, and nothing is dropped", async () => {
    const s = await open({ gate: new AuditGate({ maxKeys: 3 }) })
    for (let i = 0; i < 6; i += 1) s.audit({ time: T0 + i, userId: `user-${i}`, event: "project-created", address: "a", detail: "" })
    expect(rowsOf(s, "project-created")).toHaveLength(3)
    // A known key still writes in full.
    s.audit({ time: T0 + 10, userId: "user-0", event: "project-created", address: "a", detail: "again" })
    expect(rowsOf(s, "project-created")).toHaveLength(4)
    s.flushAuditCounts(T0 + 2 * AUDIT_WINDOW_MS)
    const count = rowsOf(s, "audit-count")
    expect(count).toHaveLength(1)
    expect(count[0]?.detail).toContain("actor=many n=3 ")
  })

  test("a maintainer command is the actor maintainer", async () => {
    const s = await open()
    for (let i = 0; i < 22; i += 1) s.audit({ time: T0 + i, userId: null, event: "invites-made", address: "cli", detail: "1" })
    expect(rowsOf(s, "audit-summarised")[0]?.detail).toBe("kind=invites-made actor=maintainer")
  })

  test("an orderly stop writes the pending counts", async () => {
    const file = await fileOf()
    server = await startTestHub({ dataDir: join(file, "..", "data") })
    const hub = server
    for (let i = 0; i < 40; i += 1) hub.hub.store.audit({ time: hub.hub.config.now(), userId: "user-a", event: "project-renamed", address: "a", detail: "" })
    expect(rowsOf(hub.hub.store, "audit-count")).toHaveLength(0)
    const dataDir = join(file, "..", "data")
    await hub.close()
    server = undefined
    store = HubStore.open(join(dataDir, "hub.db"))
    const count = rowsOf(store, "audit-count")
    expect(count).toHaveLength(1)
    expect(count[0]?.detail).toContain("n=20 ")
  })

  test("the hub's sweep writes the counts of ended windows", async () => {
    let now = Date.now()
    server = await startTestHub({ now: () => now, sweepMs: 20 })
    for (let i = 0; i < 40; i += 1) server.hub.store.audit({ time: now, userId: "user-a", event: "project-renamed", address: "a", detail: "" })
    now += AUDIT_WINDOW_MS + 1000
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && rowsOf(server.hub.store, "audit-count").length === 0) await new Promise((r) => setTimeout(r, 25))
    expect(rowsOf(server.hub.store, "audit-count")).toHaveLength(1)
  })
})

describe("every row passes the one function", () => {
  test("refused POST /oauth/token calls from one address write 20 token-refused rows, one summary and one count", async () => {
    server = await startTestHub()
    const body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: "nope", client_id: "x" }).toString()
    for (let i = 0; i < 60; i += 1) {
      const answer = await send(server.url, "POST", "/oauth/token", { host: new URL("https://cf.example.test").host, "content-type": "application/x-www-form-urlencoded" }, body)
      expect(answer.status).toBe(400)
    }
    const hub = server
    expect(rowsOf(hub.hub.store, "token-refused")).toHaveLength(20)
    expect(rowsOf(hub.hub.store, "audit-summarised")).toHaveLength(1)
    hub.hub.store.flushAuditCounts(Date.now() + AUDIT_WINDOW_MS + 1000)
    expect(rowsOf(hub.hub.store, "audit-count")[0]?.detail).toContain("n=40 ")
  })

  test("the sign-in at the correct-password limit is charged to the address and carries no user id", async () => {
    server = await startTestHub()
    await newUser(server, "ada@example.com")
    for (let i = 0; i < 30; i += 1) await new Browser(server.url).signIn("ada@example.com")
    const before = server.hub.limits.signinAddress.check("127.0.0.1", Date.now())
    const refused = await new Browser(server.url).signIn("ada@example.com")
    expect(refused.status).toBe(429)
    const row = server.hub.store.auditLog(5).find((entry) => entry.event === "signin-limited-password")
    expect(row?.userId).toBeNull()
    expect(before.ok).toBe(true)
  })

  test("direct inserts into the audit table exist only inside the store's own function", async () => {
    const { readFileSync, readdirSync } = await import("node:fs")
    const root = new URL("../src/hub/", import.meta.url)
    const offenders: string[] = []
    for (const name of readdirSync(root, { recursive: true }) as string[]) {
      if (!name.endsWith(".ts")) continue
      const text = readFileSync(new URL(name, root), "utf8")
      if (/INSERT INTO audit\b/.test(text) && name !== "store.ts") offenders.push(name)
    }
    expect(offenders).toEqual([])
    expect((readFileSync(new URL("store.ts", root), "utf8").match(/INSERT INTO audit\b/g) ?? []).length).toBe(1)
  })
})

describe("the count-based prune", () => {
  test("deletes routine rows by a range scan of the audit_event index", async () => {
    const file = await fileOf()
    store = HubStore.open(file)
    const db = new DatabaseSync(file, { readOnly: true })
    const plan = (db.prepare(`EXPLAIN QUERY PLAN ${ROUTINE_PRUNE_SQL.replace("DELETE FROM audit WHERE id IN (", "").replace(/\)$/, "")}`).all("workspace-entered", 10, 5) as { detail: string }[]).map((row) => row.detail).join(" | ")
    db.close()
    expect(plan).toContain("audit_event")
    expect(plan).not.toMatch(/SCAN audit(?! USING)/)
  })

  test("the row count is checked at most once every 10 minutes", async () => {
    const s = await open()
    s.audit({ time: T0, userId: null, event: "signin", address: "a", detail: "" })
    const spy = vi.spyOn(s, "auditOverCap")
    await pruneAudit(s, T0)
    const first = spy.mock.calls.length
    expect(first).toBeGreaterThan(0)
    await pruneAudit(s, T0 + 5 * 60_000)
    expect(spy.mock.calls.length).toBe(first)
    await pruneAudit(s, T0 + COUNT_CHECK_EVERY_MS + 1)
    expect(spy.mock.calls.length).toBeGreaterThan(first)
  })
})
