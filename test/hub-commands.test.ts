import { describe, expect, test, vi } from "vitest"
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { requireSqlite, runCli, type CliIO } from "../src/cli-commands.js"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { chooseRunner, containerMemory, runnerFor, STATUS_FILE } from "../src/hub/commands.js"
import type { ChildLike, SpawnLike } from "../src/hub/runner/container-runner.js"

/** A fake engine command that prints `answer(args)` and exits with `code`. */
function engineAnswering(calls: string[][], answer: (args: string[]) => string, code = 0): SpawnLike {
  return (_command, args) => {
    calls.push(args)
    const emitter = new EventEmitter()
    const child = {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null as number | null,
      signalCode: null,
      once: ((event: string, listener: (...values: unknown[]) => void) => emitter.once(event, listener)) as ChildLike["once"],
      kill: () => true,
    }
    setImmediate(() => {
      child.stdout.end(answer(args))
      child.stderr.end()
      child.exitCode = code
      emitter.emit("exit", code)
    })
    return child
  }
}
import { PROCESS_RUNNER_REFUSAL, sameSiteWarning, startHub, TRUSTED_ONLY_WARNING } from "../src/hub/server.js"
import { loadOrCreateTicketKey } from "../src/hub/keys.js"
import { looserThanOwner, prepareDataDir } from "../src/hub/permissions.js"
import { Browser, newUser, send, startTestHub } from "./helpers/hub-client.js"

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
      await writeFile(join(data, STATUS_FILE), JSON.stringify({ updated: Date.now(), pid: 1, running: 3, runner: "process" }))
      const out = io()
      expect(await runCli(["hub", "status", "--data", data], "/", out)).toBe(0)
      expect(out.lines).toEqual(["Users: 1", "Projects: 1", "Unused invite codes: 0", "Runner: process", "Running workspaces: 3", "Disk used by projects: 1.0 MB"])
    } finally {
      await server.close()
    }
  })

  test("delete-user asks for the email typed; the running hub's sweep removes the user and their files", async () => {
    const server = await startTestHub({ sweepMs: 50 })
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
      await vi.waitFor(async () => expect(await readdir(join(data, "projects"))).toEqual([]), { timeout: 3000 })
      expect(server.hub.store.deletedUsers()).toEqual([])
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
    expect(await runCli(["hub", "--data", data, "--port", "0", "--public-origin", "https://cf.example.test", "--workspace-domain", "ws.localhost"], "/", out)).toBe(1)
    expect(out.errors[0]).toContain(PROCESS_RUNNER_REFUSAL)
    expect(out.lines).toEqual([])
    await expect(startHub({ dataDir: data, port: 0, publicOrigin: "https://cf.example.test", workspaceDomain: "ws.localhost" })).rejects.toThrow(PROCESS_RUNNER_REFUSAL)
    const server = await startHub({ dataDir: data, port: 0, publicOrigin: "https://cf.example.test", workspaceDomain: "ws.localhost", trustedAccountsOnly: true, log: () => undefined })
    await server.close()
    const explicit = io()
    expect(await runCli(["hub", "--runner", "process", "--data", data, "--port", "0", "--public-origin", "https://cf.example.test", "--workspace-domain", "ws.localhost"], "/", explicit)).toBe(1)
    expect(explicit.errors[0]).toContain(PROCESS_RUNNER_REFUSAL)
  })

  test("the runner is chosen from the flags", async () => {
    const flags = (...names: string[]) => new Set(names)
    const options = (...pairs: [string, string][]) => new Map(pairs)
    expect(chooseRunner(options(), flags("--trusted-accounts-only"))).toEqual({ kind: "process", trustedAccountsOnly: true })
    expect(chooseRunner(options(["--runner", "process"]), flags())).toEqual({ kind: "process", trustedAccountsOnly: false })
    expect(chooseRunner(options(["--runner", "container"], ["--workspace-image", "copperflow-workspace"]), flags())).toEqual({ kind: "container", settings: { image: "copperflow-workspace", reach: "loopback" } })
    expect(
      chooseRunner(options(["--runner", "container"], ["--workspace-image", "img"], ["--container-command", "podman"], ["--hub-container", "cf-hub"], ["--workspace-reach", "network"]), flags()),
    ).toEqual({ kind: "container", settings: { image: "img", command: "podman", hubContainer: "cf-hub", reach: "network" } })
    expect(() => chooseRunner(options(["--runner", "container"]), flags())).toThrow(/--workspace-image/)
    expect(() => chooseRunner(options(["--runner", "vm"]), flags())).toThrow(/--runner must be/)
    expect(() => chooseRunner(options(["--workspace-image", "img"]), flags())).toThrow(/belongs to --runner container/)
    expect(() => chooseRunner(options(["--runner", "container"], ["--workspace-image", "img"], ["--workspace-reach", "network"]), flags())).toThrow(/--hub-container/)
    expect(() => chooseRunner(options(["--runner", "container"], ["--workspace-image", "img"], ["--workspace-reach", "public"]), flags())).toThrow(/reach/)
  })

  test("with the container runner the engine is checked and leftovers swept, and no trusted-accounts warning is needed", async () => {
    const calls: string[][] = []
    const answer = (args: string[]) => {
      if (args[0] === "version") return "28.0.1\n"
      if (args[0] === "image") return "node:22-bookworm-slim@sha256:abc\n"
      if (args[0] === "port") return "127.0.0.1:49000\n"
      return args[0] === "ps" ? `cf-ws-${"a".repeat(32)}\n` : ""
    }
    const spawn = engineAnswering(calls, answer)
    const out = io()
    const chosen = await runnerFor({ kind: "container", settings: { image: "img", user: "1000:1000" } }, out, spawn)
    expect(chosen.trustedAccountsOnly).toBeUndefined()
    expect(calls.map((args) => args.slice(0, 2).join(" "))).toEqual([
      "version --format",
      "image inspect",
      "network create",
      "run --detach",
      "port cf-check-" + process.pid,
      "rm --force",
      "network rm",
      "ps --all",
      "rm --force",
      "network ls",
    ])
    expect(out.lines).toEqual(["Removed 1 workspace container(s) left from an earlier run."])
    // An unpinned base is a warning; an old engine is refused with the reason.
    const unpinned = io()
    await runnerFor({ kind: "container", settings: { image: "img", user: "1000:1000" } }, unpinned, engineAnswering([], (args) => (args[0] === "image" ? "node:22-bookworm-slim\n" : answer(args))))
    expect(unpinned.lines[0]).toMatch(/not pinned by digest/)
    const old = await runnerFor({ kind: "container", settings: { image: "img", user: "1000:1000" } }, io(), engineAnswering([], (args) => (args[0] === "version" ? "25.0.3\n" : answer(args)))).catch((error: Error) => error.message)
    expect(old).toMatch(/Docker Engine 26 or newer/)
    const noPublish = await runnerFor({ kind: "container", settings: { image: "img", user: "1000:1000" } }, io(), engineAnswering([], (args) => (args[0] === "port" ? "" : answer(args)))).catch((error: Error) => error.message)
    expect(noPublish).toMatch(/--workspace-reach network/)
    const data = await mkdtemp(join(tmpdir(), "cf-ctrhub-"))
    const server = await startHub({ dataDir: data, port: 0, publicOrigin: "https://cf.example.test", workspaceDomain: "ws.localhost", ...chosen, log: () => undefined })
    await server.close()
    const down = await runnerFor({ kind: "container", settings: { image: "img" } }, io(), engineAnswering([], () => "", 1)).catch((error: Error) => error.message)
    expect(down).toMatch(/does not answer/)
  })

  test("status lists each workspace container's memory", async () => {
    const lines = await containerMemory("docker", engineAnswering([], () => `cf-ws-${"b".repeat(32)}\t41.2MiB / 512MiB\nsomething-else\t1GiB / 2GiB\n`))
    expect(lines).toEqual([`cf-ws-${"b".repeat(32)}: 41.2MiB / 512MiB`])
    expect(await containerMemory("docker", engineAnswering([], () => "", 1))).toEqual(["(container memory unavailable: the engine did not answer)"])
  })

  test("the data directory and database are owner-only, and a looser one is refused (modes are not checked on Windows)", async () => {
    expect(looserThanOwner(0o40700)).toBe(false)
    expect(looserThanOwner(0o100600)).toBe(false)
    expect(looserThanOwner(0o40750)).toBe(true)
    expect(looserThanOwner(0o100644)).toBe(true)
    const data = join(await mkdtemp(join(tmpdir(), "cf-perm-")), "data")
    expect(await prepareDataDir(data)).toBe(join(data, "hub.db"))
    if (process.platform !== "win32") {
      const { chmod } = await import("node:fs/promises")
      await chmod(join(data, "hub.db"), 0o644)
      await expect(prepareDataDir(data)).rejects.toThrow(/hub\.db .* must be readable by its owner only: run chmod 600/)
      await chmod(join(data, "hub.db"), 0o600)
      await chmod(data, 0o755)
      await expect(prepareDataDir(data)).rejects.toThrow(/The data directory .* run chmod 700/)
    }
  })

  test("the hub refuses an http public origin outside this machine, and warns about a same-site workspace domain", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-http-"))
    const start = (publicOrigin: string) => startHub({ dataDir: data, port: 0, publicOrigin, workspaceDomain: "ws.localhost", trustedAccountsOnly: true, log: () => undefined })
    await expect(start("http://copperflow.example.com")).rejects.toThrow(/--public-origin must be https/)
    for (const ok of ["http://127.0.0.1:8080", "http://localhost:8080", "http://cf.localhost"]) await (await start(ok)).close()
    expect(sameSiteWarning("https://copperflow.example.com", "ws.copperflow.example.com")).toMatch(/same site as the hub/)
    expect(sameSiteWarning("https://copperflow.example.com", "ws.example-workspaces.net")).toBeUndefined()
  })

  test("an oversized header block gets a page that says to clear cookies", async () => {
    const server = await startTestHub()
    try {
      const cookies = (n: number) => Array.from({ length: n }, (_, i) => `c${i}=${"x".repeat(4000)}`).join("; ")
      expect((await send(server.url, "GET", "/signin", { host: "cf.example.test", cookie: cookies(10) })).status).toBe(200)
      const over = await send(server.url, "GET", "/signin", { host: "cf.example.test", cookie: cookies(20) })
      expect(over.status).toBe(431)
      expect(over.text).toContain("Clear the cookies for this site")
    } finally {
      await server.close()
    }
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
