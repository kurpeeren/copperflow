import { afterEach, describe, expect, test } from "vitest"
import { request } from "node:http"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { generateTicketKeys, signTicket, TICKET_HEADER, TICKET_PUBLIC_KEY_ENV } from "../src/hosted/ticket.js"
import { createProcessRunner, workspaceEnvironment } from "../src/hub/runner/process-runner.js"
import { ManagedRunner, RunnerFullError, WorkspaceStartError, type Launched, type WorkspaceSpec } from "../src/hub/runner/runner.js"
import { BOARD } from "./fixtures.js"
import { workspaceCli } from "./helpers/workspace-cli.js"

const spec = (id: string): WorkspaceSpec => ({ id, userId: "u1", projectDir: `/data/${id}`, basePath: `/p/${id}` })
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
    runner = new ManagedRunner({ launch: fake.launch, log: (line) => lines.push(line) })
    await runner.ensure(spec("a"))
    fake.launched[0]?.crash()
    await wait(20)
    expect(fake.launched).toHaveLength(2)
    expect(runner.state("a")).toBe("running")
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

describe("the process runner", () => {
  test("gives the child only the public key (and SYSTEMROOT on Windows)", () => {
    expect(workspaceEnvironment("KEY", "linux", "C:\\Windows")).toEqual({ [TICKET_PUBLIC_KEY_ENV]: "KEY" })
    expect(workspaceEnvironment("KEY", "win32", "C:\\Windows")).toEqual({ [TICKET_PUBLIC_KEY_ENV]: "KEY", SYSTEMROOT: "C:\\Windows" })
  })

  test("starts a real hosted workspace and stops it", async () => {
    const keys = generateTicketKeys()
    const projectDir = await mkdtemp(join(tmpdir(), "cf-proc-"))
    await writeFile(join(projectDir, "main.circuit.tsx"), BOARD)
    runner = createProcessRunner({ publicOrigin: "https://cf.example.test", ticketPublicKey: keys.publicKeyBase64, command: await workspaceCli(), log: () => undefined })
    const address = await runner.ensure({ id: "p1", userId: "u1", projectDir, basePath: "/p/p1" })
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
