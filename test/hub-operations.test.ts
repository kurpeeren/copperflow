import { describe, expect, test, vi } from "vitest"
import { spawn } from "node:child_process"
import { copyFile, cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { runCli, type CliIO } from "../src/cli-commands.js"
import { RUNNER_UNKNOWN_NOTE, STATUS_FILE } from "../src/hub/commands.js"
import { TRUSTED_ONLY_WARNING } from "../src/hub/server.js"
import { HubStore, SCHEMA_VERSION } from "../src/hub/store.js"
import { newUser, projectOriginOf, send, startTestHub } from "./helpers/hub-client.js"

function io(): CliIO & { lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return { lines, errors, out: (text) => lines.push(text), err: (text) => errors.push(text) }
}

const COUNTS = /^\{"users":\d+,"projects":\d+,"unusedInvites":\d+\}$/

describe("hub backup", () => {
  test("a backup restores to the same counts, and a project file comes back byte for byte", async () => {
    const server = await startTestHub()
    const data = join(server.hub.files.root, "..")
    const ada = await newUser(server, "ada@example.com")
    await newUser(server, "bob@example.com")
    await ada.submit("/projects", "/projects", { name: "Amp" })
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    const projectId = server.hub.store.projects(userId)[0]?.id as string
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7) % 256))
    await writeFile(join(server.hub.files.projectDir(userId, projectId), "board.bin"), bytes)
    const before = server.hub.store.counts()
    const out = io()
    const snapshot = join(await mkdtemp(join(tmpdir(), "cf-bak-")), "hub.db")
    try {
      // Taken while the hub is running, as the nightly script does.
      expect(await runCli(["hub", "backup", "--data", data, "--to", snapshot], "/", out)).toBe(0)
    } finally {
      await server.close()
    }
    expect(out.lines).toEqual([JSON.stringify(before)])
    expect(out.lines[0]).toMatch(COUNTS)
    expect(before).toEqual({ users: 2, projects: 1, unusedInvites: 0 })
    // Restore: the snapshot as hub.db, the key and the projects tree beside it (what the archive holds).
    const restored = join(await mkdtemp(join(tmpdir(), "cf-restore-")), "data")
    await cp(join(data, "projects"), join(restored, "projects"), { recursive: true, verbatimSymlinks: true })
    await copyFile(snapshot, join(restored, "hub.db"))
    await copyFile(join(data, "ticket-key.pem"), join(restored, "ticket-key.pem"))
    const status = io()
    expect(await runCli(["hub", "status", "--json", "--data", restored], "/", status)).toBe(0)
    const reported = JSON.parse(status.lines[0] as string) as Record<string, unknown>
    expect({ users: reported.users, projects: reported.projects, unusedInvites: reported.unusedInvites }).toEqual(before)
    expect(await readFile(join(restored, "projects", userId, projectId, "board.bin"))).toEqual(bytes)
  })

  test("refuses to overwrite a file, and needs --to", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-bak-"))
    const existing = join(data, "already.db")
    await writeFile(existing, "x")
    const out = io()
    expect(await runCli(["hub", "backup", "--data", data, "--to", existing], "/", out)).toBe(1)
    expect(out.errors[0]).toMatch(/already exists/)
    expect(await readFile(existing, "utf8")).toBe("x")
    const missing = io()
    expect(await runCli(["hub", "backup", "--data", data], "/", missing)).toBe(1)
    expect(missing.errors[0]).toMatch(/--to <file>/)
  })

  test("a backup taken while another process writes is a whole, consistent database", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-bak-live-"))
    HubStore.open(join(data, "hub.db")).close()
    // Another process (as the running hub is) writes audit rows as fast as it can until it is killed.
    const writer = spawn(process.execPath, [
      "--no-warnings",
      "-e",
      `const { DatabaseSync } = require("node:sqlite")
       const db = new DatabaseSync(process.argv[1])
       db.exec("PRAGMA busy_timeout = 5000")
       const insert = db.prepare("INSERT INTO audit (time, user_id, event, address, detail) VALUES (?, NULL, 'test', 'test', ?)")
       process.stdout.write("ready\\n")
       for (;;) { db.exec("BEGIN"); for (let i = 0; i < 50; i += 1) insert.run(Date.now(), "x".repeat(200)); db.exec("COMMIT") }`,
      join(data, "hub.db"),
    ])
    try {
      await new Promise<void>((done, fail) => {
        writer.stdout.once("data", () => done())
        writer.once("exit", (code) => fail(new Error(`the writer stopped: ${code}`)))
      })
      let last = -1
      for (let round = 0; round < 3; round += 1) {
        const snapshot = join(await mkdtemp(join(tmpdir(), "cf-bak-snap-")), "hub.db")
        expect(await runCli(["hub", "backup", "--data", data, "--to", snapshot], "/", io())).toBe(0)
        const copy = new DatabaseSync(snapshot, { readOnly: true })
        try {
          expect(copy.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
          const rows = Number((copy.prepare("SELECT COUNT(*) AS n FROM audit").get() as { n: number }).n)
          // Whole transactions only: the writer commits 50 rows at a time.
          expect(rows % 50).toBe(0)
          expect(rows).toBeGreaterThanOrEqual(last)
          last = rows
        } finally {
          copy.close()
        }
      }
    } finally {
      writer.kill()
    }
  }, 30_000)
})

describe("hub status --json", () => {
  test("gives the same fields as the text form, sanitised", async () => {
    const server = await startTestHub()
    const data = join(server.hub.files.root, "..")
    try {
      await newUser(server, "ada@example.com")
      await writeFile(
        join(data, STATUS_FILE),
        JSON.stringify({ updated: Date.now(), pid: 1, running: 2, runner: "process", trashFailures: [{ name: "evil\u001b[31m\nname", failures: 4, reason: "permission" }] }),
      )
      const out = io()
      expect(await runCli(["hub", "status", "--json", "--data", data], "/", out)).toBe(0)
      expect(out.lines).toHaveLength(1)
      const status = JSON.parse(out.lines[0] as string) as Record<string, unknown>
      expect(Object.keys(status).sort()).toEqual(["containerMemory", "diskBytes", "projects", "runner", "running", "trashPending", "trashStuck", "unusedInvites", "users"].sort())
      expect(status).toMatchObject({ users: 1, projects: 0, unusedInvites: 0, runner: "process", running: 2, trashPending: 0, diskBytes: 0, containerMemory: [] })
      const stuck = status.trashStuck as { name: string; failures: number; reason: string }[]
      expect(stuck).toHaveLength(1)
      expect(stuck[0]?.failures).toBe(4)
      expect(stuck[0]?.name).not.toMatch(/[\u0000-\u001f\u007f]/)
    } finally {
      await server.close()
    }
  })

  test("says null where the text form says unknown", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-status-"))
    const out = io()
    expect(await runCli(["hub", "status", "--data", data, "--json"], "/", out)).toBe(0)
    expect(JSON.parse(out.lines[0] as string)).toMatchObject({ runner: null, running: null })
  })
})

describe("hub invite and the runner", () => {
  test("warns about trusted accounts only when the hub last ran the process runner", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-invite-"))
    const run = async () => {
      const out = io()
      expect(await runCli(["hub", "invite", "--data", data], "/", out)).toBe(0)
      return out.lines.slice(2)
    }
    expect(await run()).toEqual([RUNNER_UNKNOWN_NOTE])
    await writeFile(join(data, STATUS_FILE), JSON.stringify({ updated: 0, pid: 1, running: 0, runner: "container" }))
    expect(await run()).toEqual([])
    await writeFile(join(data, STATUS_FILE), JSON.stringify({ updated: 0, pid: 1, running: 0, runner: "process" }))
    expect(await run()).toEqual([TRUSTED_ONLY_WARNING])
  })
})

describe("hub stop-workspace", () => {
  test("the running hub stops that workspace through the runner's stop, and refuses a bad or unknown id", async () => {
    const server = await startTestHub({ sweepMs: 50 })
    const data = join(server.hub.files.root, "..")
    const stopped: string[] = []
    const stop = server.hub.runner.stop.bind(server.hub.runner)
    server.hub.runner.stop = async (id: string) => {
      stopped.push(id)
      return stop(id)
    }
    try {
      const ada = await newUser(server, "ada@example.com")
      await ada.submit("/projects", "/projects", { name: "Amp" })
      const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
      const id = server.hub.store.projects(userId)[0]?.id as string
      const out = io()
      expect(await runCli(["hub", "stop-workspace", id, "--data", data], "/", out)).toBe(0)
      expect(out.lines[0]).toContain(id)
      await vi.waitFor(() => expect(stopped).toEqual([id]), { timeout: 3000 })
      for (const bad of ["../etc", "A".repeat(32), "0".repeat(32), `${"a".repeat(31)}\u001b`]) {
        const refused = io()
        expect(await runCli(["hub", "stop-workspace", bad, "--data", data], "/", refused)).toBe(1)
        expect(refused.errors[0]).not.toContain("\u001b")
      }
      expect(stopped).toEqual([id])
    } finally {
      await server.close()
    }
  })
})

describe("the schema version", () => {
  test("a new database gets the current version, an old one is migrated, a newer one is refused", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cf-schema-"))
    const fresh = join(dir, "fresh.db")
    HubStore.open(fresh).close()
    const version = (file: string) => {
      const db = new DatabaseSync(file, { readOnly: true })
      try {
        return Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version)
      } finally {
        db.close()
      }
    }
    expect(version(fresh)).toBe(SCHEMA_VERSION)
    // A database from before versions were kept: the first schema without the later columns and tables.
    const old = join(dir, "old.db")
    const db = new DatabaseSync(old)
    db.exec("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, created INTEGER NOT NULL); INSERT INTO users VALUES ('u1', 'ada@example.com', 'x', 1)")
    db.close()
    const migrated = HubStore.open(old)
    expect(migrated.userByEmail("ada@example.com")?.id).toBe("u1")
    migrated.requestStop("a".repeat(32), 1)
    expect(migrated.stopRequests()).toEqual(["a".repeat(32)])
    migrated.close()
    expect(version(old)).toBe(SCHEMA_VERSION)
    const newer = new DatabaseSync(fresh)
    newer.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    newer.close()
    expect(() => HubStore.open(fresh)).toThrow(/newer copperflow .*Nothing was changed.*copperflow hub backup/)
    expect(version(fresh)).toBe(SCHEMA_VERSION + 1)
  })
})

describe("HSTS", () => {
  test("every answer of an https hub carries Strict-Transport-Security, without subdomains unless asked", async () => {
    const plain = await startTestHub()
    const wide = await startTestHub({ hstsIncludeSubdomains: true })
    const local = await startTestHub({ publicOrigin: "http://127.0.0.1:8080" })
    try {
      for (const [path, host] of [["/signin", "cf.example.test"], ["/healthz", "cf.example.test"], ["/", new URL(projectOriginOf("a".repeat(32))).host], ["/nowhere", "cf.example.test"]] as const) {
        expect((await send(plain.url, "GET", path, { host })).headers["strict-transport-security"], path).toBe("max-age=31536000")
      }
      expect((await send(wide.url, "GET", "/signin", { host: "cf.example.test" })).headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains")
      expect((await send(local.url, "GET", "/healthz", { host: "127.0.0.1:8080" })).headers["strict-transport-security"]).toBeUndefined()
    } finally {
      await Promise.all([plain.close(), wide.close(), local.close()])
    }
  })

  test("--hsts-include-subdomains is a flag of the hub's command line", async () => {
    const { parseServeArgs } = await import("../src/hub/commands.js")
    const base = ["--data", "/srv/cf", "--port", "8780", "--public-origin", "https://cf.example.test", "--workspace-domain", "ws.example.net", "--trusted-accounts-only"]
    expect(parseServeArgs(base, "/").hstsIncludeSubdomains).toBe(false)
    expect(parseServeArgs([...base, "--hsts-include-subdomains"], "/").hstsIncludeSubdomains).toBe(true)
  })
})

describe("stop requests", () => {
  test("are removed one at a time when done; a failed stop is kept and retried, and the others still happen", async () => {
    const server = await startTestHub({ sweepMs: 50 })
    const stopped: string[] = []
    let failOnce = true
    server.hub.runner.stop = async (id: string) => {
      if (id === "b".repeat(32) && failOnce) {
        failOnce = false
        throw new Error("engine did not answer")
      }
      stopped.push(id)
    }
    try {
      server.hub.store.requestStop("b".repeat(32), 1)
      server.hub.store.requestStop("c".repeat(32), 2)
      await vi.waitFor(() => expect([...stopped].sort()).toEqual(["b".repeat(32), "c".repeat(32)]), { timeout: 3000 })
      expect(server.hub.store.stopRequests()).toEqual([])
    } finally {
      await server.close()
    }
  })
})

describe("the schema version is checked before anything changes", () => {
  test("a newer database keeps its journal mode", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "cf-newer-")), "hub.db")
    const db = new DatabaseSync(file)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    db.close()
    expect(() => HubStore.open(file)).toThrow(/newer copperflow/)
    const after = new DatabaseSync(file, { readOnly: true })
    try {
      expect(after.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "delete" })
    } finally {
      after.close()
    }
  })
})

describe("the certificate check behind a proxy", () => {
  test("a forwarded request is refused even from loopback; the proxy's own ask is answered", async () => {
    const server = await startTestHub()
    try {
      const path = "/_tls-ask?domain=cf.example.test"
      expect((await send(server.url, "GET", path, { host: "cf.example.test" })).status).toBe(200)
      const forwarded: Record<string, string>[] = [{ "x-forwarded-for": "203.0.113.9" }, { forwarded: "for=203.0.113.9" }, { via: "1.1 caddy" }]
      for (const header of forwarded) {
        expect((await send(server.url, "GET", path, { host: "cf.example.test", ...header })).status).toBe(404)
      }
    } finally {
      await server.close()
    }
  })
})

describe("GET /healthz", () => {
  test("answers 200 with no detail and no session, on any host, and is never proxied for a project", async () => {
    const server = await startTestHub()
    try {
      for (const host of ["cf.example.test", "127.0.0.1", new URL(projectOriginOf("a".repeat(32))).host]) {
        const answer = await send(server.url, "GET", "/healthz", { host })
        expect(answer.status).toBe(200)
        expect(answer.text).toBe("ok\n")
        expect(answer.headers["set-cookie"]).toBeUndefined()
        expect(answer.headers["cache-control"]).toBe("no-store")
      }
      expect((await send(server.url, "HEAD", "/healthz", { host: "cf.example.test" })).status).toBe(200)
      expect((await send(server.url, "POST", "/healthz", { host: "cf.example.test" })).status).not.toBe(200)
      expect((await send(server.url, "GET", "/healthz?x=1", { host: "cf.example.test" })).status).not.toBe(200)
      // Many in a row: never rate limited.
      for (let i = 0; i < 50; i += 1) expect((await send(server.url, "GET", "/healthz", { host: "cf.example.test" })).status).toBe(200)
    } finally {
      await server.close()
    }
  })
})
