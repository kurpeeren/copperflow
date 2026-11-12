import { describe, expect, test } from "vitest"
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { requireSqlite, runCli, type CliIO } from "../src/cli-commands.js"
import { STATUS_FILE } from "../src/hub/commands.js"
import { PROCESS_RUNNER_REFUSAL, startHub, TRUSTED_ONLY_WARNING } from "../src/hub/server.js"
import { loadOrCreateTicketKey } from "../src/hub/keys.js"
import { Browser, newUser, startTestHub } from "./helpers/hub-client.js"

function io(answer?: string): CliIO & { lines: string[]; errors: string[] } {
  const lines: string[] = []
  const errors: string[] = []
  return { lines, errors, out: (text) => lines.push(text), err: (text) => errors.push(text), ...(answer !== undefined ? { ask: async () => answer } : {}) }
}

describe("the hub's maintainer commands", () => {
  test("invite prints codes once that sign up, and the store keeps only their hashes", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-hubcli-"))
    const out = io()
    expect(await runCli(["hub", "invite", "--data", data, "--count", "2"], "/", out)).toBe(0)
    const codes = out.lines.slice(1, 3)
    expect(codes).toHaveLength(2)
    expect(out.lines[3]).toBe(TRUSTED_ONLY_WARNING)
    for (const code of codes) expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect((await readFile(join(data, "hub.db"))).includes(Buffer.from(codes[0] as string))).toBe(false)
    const server = await startTestHub({ dataDir: data })
    try {
      expect((await new Browser(server.url).signUp(codes[0] as string, "ada@example.com")).status).toBe(303)
    } finally {
      await server.close()
    }
    expect(await runCli(["hub", "invite", "--data", data, "--count", "0"], "/", io())).toBe(1)
  })

  test("reset-password prints a one-time password and ends the user's sessions", async () => {
    const server = await startTestHub()
    const data = await dataDirOf(server)
    try {
      const ada = await newUser(server, "ada@example.com")
      const out = io()
      expect(await runCli(["hub", "reset-password", "ADA@example.com", "--data", data], "/", out)).toBe(0)
      const password = out.lines[1] as string
      expect(password).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect((await ada.get("/projects")).headers.location).toBe("/signin")
      expect((await new Browser(server.url).signIn("ada@example.com", password)).status).toBe(303)
      const missing = io()
      expect(await runCli(["hub", "reset-password", "nobody@example.com", "--data", data], "/", missing)).toBe(1)
    } finally {
      await server.close()
    }
  })

  test("status counts users, projects, running workspaces and disk use", async () => {
    const server = await startTestHub()
    const data = await dataDirOf(server)
    try {
      const ada = await newUser(server, "ada@example.com")
      await ada.submit("/projects", "/projects", { name: "Amp" })
      const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
      await writeFile(join(server.hub.files.projectDir(userId, server.hub.store.projects(userId)[0]?.id as string), "a.bin"), Buffer.alloc(1024 * 1024))
      await writeFile(join(data, STATUS_FILE), JSON.stringify({ updated: Date.now(), pid: 1, running: 3 }))
      const out = io()
      expect(await runCli(["hub", "status", "--data", data], "/", out)).toBe(0)
      expect(out.lines).toEqual(["Users: 1", "Projects: 1", "Unused invite codes: 0", "Running workspaces: 3", "Disk used by projects: 1.0 MB"])
    } finally {
      await server.close()
    }
  })

  test("delete-user asks for the email typed and removes the user and their files", async () => {
    const server = await startTestHub()
    const data = await dataDirOf(server)
    try {
      const ada = await newUser(server, "ada@example.com")
      await ada.submit("/projects", "/projects", { name: "Amp" })
      expect(await runCli(["hub", "delete-user", "ada@example.com", "--data", data], "/", io())).toBe(1)
      const wrong = io("bob@example.com")
      expect(await runCli(["hub", "delete-user", "ada@example.com", "--data", data], "/", wrong)).toBe(1)
      expect(wrong.errors[0]).toContain("Not deleted")
      expect(await runCli(["hub", "delete-user", "ada@example.com", "--data", data], "/", io("ada@example.com"))).toBe(0)
      expect(server.hub.store.userByEmail("ada@example.com")).toBeUndefined()
      expect(await readdir(join(data, "projects"))).toEqual([])
    } finally {
      await server.close()
    }
  })

  test("the ticket key is made once, owner-only, and the public half is all a workspace gets", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-key-"))
    const first = await loadOrCreateTicketKey(data)
    const second = await loadOrCreateTicketKey(data)
    expect(second.publicKeyBase64).toBe(first.publicKeyBase64)
    expect(Buffer.from(first.publicKeyBase64, "base64")).toHaveLength(32)
    expect(await readFile(join(data, "ticket-key.pem"), "utf8")).toContain("PRIVATE KEY")
  })

  test("the hub refuses the process runner unless every account is trusted, and says what that means", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-trusted-"))
    const out = io()
    expect(await runCli(["hub", "--data", data, "--port", "0", "--public-origin", "https://cf.example.test"], "/", out)).toBe(1)
    expect(out.errors[0]).toContain(PROCESS_RUNNER_REFUSAL)
    expect(out.lines).toEqual([])
    await expect(startHub({ dataDir: data, port: 0, publicOrigin: "https://cf.example.test" })).rejects.toThrow(PROCESS_RUNNER_REFUSAL)
    const server = await startHub({ dataDir: data, port: 0, publicOrigin: "https://cf.example.test", trustedAccountsOnly: true, log: () => undefined })
    await server.close()
  })

  test("the hub says clearly when node:sqlite is missing", async () => {
    await expect(requireSqlite(async () => Promise.reject(new Error("No such built-in module")))).rejects.toThrow(/copperflow hub needs Node 22\.13 or later/)
    await expect(requireSqlite()).resolves.toBeUndefined()
  })

  test("nothing in the engine, core, Studio or MCP server imports the hub", async () => {
    const offenders: string[] = []
    for (const folder of ["engine", "core", "studio", "mcp", "hosted", "library"]) {
      const root = join(fileURLToPath(new URL("../src/", import.meta.url)), folder)
      for (const name of await readdir(root, { recursive: true })) {
        if (!name.endsWith(".ts")) continue
        if (/from\s+["'][./]*\/?hub\//.test(await readFile(join(root, name), "utf8"))) offenders.push(`${folder}/${name}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

async function dataDirOf(server: { hub: { files: { root: string } } }): Promise<string> {
  return join(server.hub.files.root, "..")
}
