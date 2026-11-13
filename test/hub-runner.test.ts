import { afterEach, describe, expect, test } from "vitest"
import { request } from "node:http"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateTicketKeys, signTicket, TICKET_HEADER, TICKET_PUBLIC_KEY_ENV } from "../src/hosted/ticket.js"
import { createProcessRunner, workspaceEnvironment } from "../src/hub/runner/process-runner.js"
import { ManagedRunner, RunnerFullError, WorkspaceBackoffError, WorkspaceStartError, type Launched, type WorkspaceSpec } from "../src/hub/runner/runner.js"
import { BOARD } from "./fixtures.js"
import { workspaceCli } from "./helpers/workspace-cli.js"

const spec = (id: string): WorkspaceSpec => ({ id, userId: "u1", projectDir: `/data/${id}`, basePath: "", publicOrigin: `https://${id}.ws.localhost` })
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** A launcher whose workspaces the test can crash. */
function fakeLauncher() {
  const launched: { id: string; crash(): void; stopped: boolean }[] = []
  const launch = async (s: WorkspaceSpec): Promise<Launched> => {
    let end!: () => void
    const exited = new Promise<void>((done) => (end = done))
    const record = { id: s.id, crash: () => end(), stopped: false }
    launched.push(record)
    return {
      address: { studio: `http://127.0.0.1:${1000 + launched.length}`, mcp: "http://127.0.0.1:2000" },
      exited,
      stop: async () => {
        record.stopped = true
        end()
      },
    }
  }
  return { launch, launched }
}

let runner: ManagedRunner | undefined
afterEach(async () => {
  await runner?.stopAll()
  runner = undefined
})

describe("the managed runner", () => {
  test("starts on demand, reuses a running workspace and stops it when idle", async () => {
    const fake = fakeLauncher()
    runner = new ManagedRunner({ launch: fake.launch, idleMs: 60, log: () => undefined })
    expect(runner.state("a")).toBe("stopped")
    const first = runner.ensure(spec("a"))
    expect(runner.state("a")).toBe("starting")
    expect(await first).toEqual({ studio: "http://127.0.0.1:1001", mcp: "http://127.0.0.1:2000" })
    expect(await runner.ensure(spec("a"))).toEqual(await first)
    expect(fake.launched).toHaveLength(1)
    expect(runner.state("a")).toBe("running")
    // A request in flight keeps it alive past the idle time.
    const release = runner.hold("a")
    await wait(150)
    expect(runner.state("a")).toBe("running")
    release()
    await wait(150)
    expect(runner.state("a")).toBe("stopped")
    expect(fake.launched[0]?.stopped).toBe(true)
  })

  test("restarts a crashed workspace once, then marks it failed", async () => {
    const fake = fakeLauncher()
    const lines: string[] = []
    let now = 1_000_000
    runner = new ManagedRunner({ launch: fake.launch, log: (line) => lines.push(line), now: () => now })
    await runner.ensure(spec("a"))
    // It ran for two minutes: not a quick exit, so it is restarted at once.
    now += 120_000
    fake.launched[0]?.crash()
    await wait(20)
    expect(fake.launched).toHaveLength(2)
    expect(runner.state("a")).toBe("running")
    now += 120_000
    fake.launched[1]?.crash()
    await wait(20)
    expect(fake.launched).toHaveLength(2)
    expect(runner.state("a")).toBe("failed")
    expect(lines).toEqual(["workspace a: ended unexpectedly; restarting it once", "workspace a: ended again after its restart; marked failed"])
    // A person's next request starts it afresh.
    await runner.ensure(spec("a"))
    expect(runner.state("a")).toBe("running")
  })

  test("refuses beyond the cap with a clear message", async () => {
    runner = new ManagedRunner({ launch: fakeLauncher().launch, maxRunning: 2, log: () => undefined })
    await runner.ensure(spec("a"))
    await runner.ensure(spec("b"))
    expect(runner.running()).toBe(2)
    await expect(runner.ensure(spec("c"))).rejects.toThrow(RunnerFullError)
    await expect(runner.ensure(spec("c"))).rejects.toThrow("The service is busy: 2 workspaces are already running, the most it runs at once. Try again in a few minutes.")
    await runner.stop("a")
    expect((await runner.ensure(spec("c"))).studio).toMatch(/^http/)
  })

  test("a user runs at most 3 workspaces: a 4th stops their own least recently used one", async () => {
    const fake = fakeLauncher()
    runner = new ManagedRunner({ launch: fake.launch, log: () => undefined })
    for (const id of ["a", "b", "c"]) {
      await runner.ensure(spec(id))
      await wait(2)
    }
    await runner.ensure(spec("a"))
    await runner.ensure(spec("d"))
    expect(["a", "b", "c", "d"].map((id) => runner?.state(id))).toEqual(["running", "stopped", "running", "running"])
    expect(fake.launched.find((l) => l.id === "b")?.stopped).toBe(true)
  })

  test("when the server is full, a user above the fair share gives way; otherwise the request is refused", async () => {
    runner = new ManagedRunner({ launch: fakeLauncher().launch, maxRunning: 4, log: () => undefined })
    const of = (id: string, userId: string): WorkspaceSpec => ({ ...spec(id), userId })
    for (const id of ["a1", "a2", "a3"]) {
      await runner.ensure(of(id, "ua"))
      await wait(2)
    }
    await runner.ensure(of("b1", "ub"))
    // ub asks for a second: ua holds 3 of 4 above a fair share of 2, so ua's oldest stops.
    await runner.ensure(of("b2", "ub"))
    expect(runner.state("a1")).toBe("stopped")
    expect(runner.running()).toBe(4)
    // Now ua has 2 and ub 2: a third user's share is 4/3, both are above it, the oldest gives way.
    await runner.ensure(of("c1", "uc"))
    expect(runner.running()).toBe(4)
    const full = new ManagedRunner({ launch: fakeLauncher().launch, maxRunning: 2, log: () => undefined })
    await full.ensure(of("x", "ux"))
    await full.ensure(of("y", "uy"))
    await expect(full.ensure(of("z", "ux"))).rejects.toThrow(RunnerFullError)
    await full.stopAll()
  })

  test("a held request keeps a workspace alive for at most the hold limit", async () => {
    runner = new ManagedRunner({ launch: fakeLauncher().launch, idleMs: 30, maxHoldMs: 60, log: () => undefined })
    await runner.ensure(spec("a"))
    runner.hold("a")
    await wait(45)
    expect(runner.state("a")).toBe("running")
    await wait(150)
    expect(runner.state("a")).toBe("stopped")
  })

  test("a failed start gives a message without the launcher's error", async () => {
    const lines: string[] = []
    runner = new ManagedRunner({ launch: async () => Promise.reject(new Error("secret /srv/path")), log: (line) => lines.push(line) })
    const refusal = (await runner.ensure(spec("a")).catch((error: unknown) => error)) as Error
    expect(refusal).toBeInstanceOf(WorkspaceStartError)
    expect(refusal.message).toBe("The workspace could not be started. Try again in a minute.")
    expect(runner.state("a")).toBe("failed")
    expect(lines).toEqual(["workspace a: start failed: secret /srv/path"])
  })

  test("refuses a workspace id reused for another project", async () => {
    runner = new ManagedRunner({ launch: fakeLauncher().launch, log: () => undefined })
    await runner.ensure(spec("a"))
    await expect(runner.ensure({ ...spec("a"), userId: "u2" })).rejects.toThrow("A workspace id was reused for another project")
  })
})

describe("a workspace that keeps failing is not restarted on every request", () => {
  /** A launcher that fails its first `failures` launches, then works; every launch is counted. */
  function flaky(failures: number) {
    const state = { launches: 0, crashes: [] as (() => void)[] }
    const launch = async (s: WorkspaceSpec): Promise<Launched> => {
      state.launches += 1
      if (state.launches <= failures) throw new Error(`boom ${s.id}`)
      let end!: () => void
      const exited = new Promise<void>((done) => (end = done))
      state.crashes.push(end)
      return { address: { studio: "http://127.0.0.1:1", mcp: "http://127.0.0.1:2" }, exited, stop: async () => end() }
    }
    return { state, launch }
  }

  test("after a failed start the next waits 2 s, then 4 s, 8 s, up to 5 minutes; requests meanwhile get a backoff error and no launch", async () => {
    let now = 1_000_000
    const fake = flaky(100)
    runner = new ManagedRunner({ launch: fake.launch, log: () => undefined, now: () => now })
    await expect(runner.ensure(spec("a"))).rejects.toBeInstanceOf(WorkspaceStartError)
    expect(fake.state.launches).toBe(1)
    for (let i = 0; i < 5; i += 1) {
      const refusal = (await runner.ensure(spec("a")).catch((error: unknown) => error)) as WorkspaceBackoffError
      expect(refusal).toBeInstanceOf(WorkspaceBackoffError)
      expect(refusal.retryAfterS).toBe(2)
    }
    expect(fake.state.launches).toBe(1)
    now += 2_000
    await expect(runner.ensure(spec("a"))).rejects.toBeInstanceOf(WorkspaceStartError)
    expect(fake.state.launches).toBe(2)
    now += 3_999
    expect(((await runner.ensure(spec("a")).catch((error: unknown) => error)) as WorkspaceBackoffError).retryAfterS).toBe(1)
    now += 1
    await expect(runner.ensure(spec("a"))).rejects.toBeInstanceOf(WorkspaceStartError)
    expect(fake.state.launches).toBe(3)
    const waits: number[] = []
    for (let i = 0; i < 10; i += 1) {
      const left = ((await runner.ensure(spec("a")).catch((error: unknown) => error)) as WorkspaceBackoffError).retryAfterS
      waits.push(left)
      now += left * 1000
      await runner.ensure(spec("a")).catch(() => undefined)
    }
    expect(Math.max(...waits)).toBe(300)
    expect(waits.at(-1)).toBe(300)
  })

  test("one workspace's backoff never delays another's start", async () => {
    const now = 1_000_000
    const launches: string[] = []
    runner = new ManagedRunner({
      launch: async (s) => {
        launches.push(s.id)
        if (s.id === "bad") throw new Error("boom")
        return fakeLauncher().launch(s)
      },
      log: () => undefined,
      now: () => now,
    })
    await expect(runner.ensure(spec("bad"))).rejects.toBeInstanceOf(WorkspaceStartError)
    await expect(runner.ensure(spec("bad"))).rejects.toBeInstanceOf(WorkspaceBackoffError)
    await expect(runner.ensure({ ...spec("good"), userId: "u2" })).resolves.toBeDefined()
    expect(launches).toEqual(["bad", "good"])
  })

  test("a workspace that exits within 60 s of starting waits; one that ran 10 minutes resets the wait", async () => {
    let now = 1_000_000
    const fake = flaky(0)
    runner = new ManagedRunner({ launch: fake.launch, log: () => undefined, now: () => now })
    await runner.ensure(spec("a"))
    now += 10_000
    fake.state.crashes[0]?.()
    await wait(20)
    // No immediate restart, and the next request waits 2 s.
    expect(fake.state.launches).toBe(1)
    expect(runner.state("a")).toBe("failed")
    await expect(runner.ensure(spec("a"))).rejects.toBeInstanceOf(WorkspaceBackoffError)
    now += 2_000
    await runner.ensure(spec("a"))
    expect(fake.state.launches).toBe(2)
    // A second quick exit doubles the wait to 4 s.
    now += 5_000
    fake.state.crashes[1]?.()
    await wait(20)
    expect(((await runner.ensure(spec("a")).catch((error: unknown) => error)) as WorkspaceBackoffError).retryAfterS).toBe(4)
    now += 4_000
    await runner.ensure(spec("a"))
    expect(fake.state.launches).toBe(3)
    // It runs 11 minutes, then ends: the wait is reset, so the restart is at once (not a quick exit).
    now += 11 * 60_000
    fake.state.crashes[2]?.()
    await wait(20)
    expect(fake.state.launches).toBe(4)
    expect(runner.state("a")).toBe("running")
    // And a later quick exit starts again from 2 s.
    now += 1_000
    fake.state.crashes[3]?.()
    await wait(20)
    expect(((await runner.ensure(spec("a")).catch((error: unknown) => error)) as WorkspaceBackoffError).retryAfterS).toBe(2)
  })
})

describe("the process runner", () => {
  test("gives the child only the public key (and SYSTEMROOT on Windows)", () => {
    expect(workspaceEnvironment("KEY", "linux", "C:\\Windows")).toEqual({ [TICKET_PUBLIC_KEY_ENV]: "KEY" })
    expect(workspaceEnvironment("KEY", "win32", "C:\\Windows")).toEqual({ [TICKET_PUBLIC_KEY_ENV]: "KEY", SYSTEMROOT: "C:\\Windows" })
  })

  test("starts a real hosted workspace and stops it", async () => {
    const keys = generateTicketKeys()
    const projectDir = await mkdtemp(join(tmpdir(), "cf-proc-"))
    await writeFile(join(projectDir, "main.circuit.tsx"), BOARD)
    runner = createProcessRunner({ ticketPublicKey: keys.publicKeyBase64, command: await workspaceCli(), log: () => undefined })
    const address = await runner.ensure({ id: "p1", userId: "u1", projectDir, basePath: "/p/p1", publicOrigin: "https://cf.example.test" })
    const now = Math.floor(Date.now() / 1000)
    const ticket = signTicket({ w: "p1", u: "u1", iat: now, exp: now + 60 }, keys.privateKey)
    const body = await new Promise<string>((done, fail) => {
      const req = request({ host: "127.0.0.1", port: new URL(address.studio).port, path: "/p/p1/api/circuits", headers: { host: "cf.example.test", [TICKET_HEADER]: ticket } }, (res) => {
        let text = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => (text += chunk))
        res.on("end", () => done(text))
      })
      req.on("error", fail)
      req.end()
    })
    expect(JSON.parse(body).data).toEqual(["main.circuit.tsx"])
    await runner.stop("p1")
    expect(runner.state("p1")).toBe("stopped")
  })
})
