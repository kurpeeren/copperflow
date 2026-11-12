import { describe, expect, test } from "vitest"
import { spawn } from "node:child_process"
import { copyFile, cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { runCli, type CliIO } from "../src/cli-commands.js"
import { STATUS_FILE } from "../src/hub/commands.js"
import { HubStore } from "../src/hub/store.js"
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
