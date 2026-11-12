import { describe, expect, test, vi } from "vitest"
import { rmSync, symlinkSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { canStart, forgetMeasurement, measureUser, OverQuotaError, ProjectBusyError, sweepQuota, withProjectLock } from "../src/hub/quota.js"
import { ManagedRunner, StopUnconfirmedError, type Launched, type WorkspaceSpec } from "../src/hub/runner/runner.js"
import { isInside, measureTree, walkProject, TooManyEntriesError } from "../src/hub/safe-files.js"
import type { HubServer } from "../src/hub/server.js"
import { newUser, projectOriginOf, startTestHub } from "./helpers/hub-client.js"

async function userWithProjects(server: HubServer, email: string, names: string[]) {
  const person = await newUser(server, email)
  for (const name of names) await person.submit("/projects", "/projects", { name })
  const userId = server.hub.store.userByEmail(email)?.id as string
  const ids = server.hub.store.projects(userId).map((project) => project.id)
  const spec = (id: string): WorkspaceSpec => ({ id, userId, projectDir: server.hub.files.projectDir(userId, id), basePath: "", publicOrigin: projectOriginOf(id) })
  return { person, userId, ids, spec }
}

describe("the disk quota while workspaces run", () => {
  test("a folder grown past the quota stops the workspace within one sweep; no project of that user starts until files are removed", async () => {
    const server = await startTestHub({ maxBytes: 10_000, quotaSweepMs: 50 })
    try {
      const ada = await userWithProjects(server, "ada@example.com", ["Amp", "Bus"])
      const [a, b] = ada.ids as [string, string]
      await server.hub.runner.ensure(ada.spec(a))
      await writeFile(join(ada.spec(a).projectDir, "big.bin"), Buffer.alloc(20_000))
      await vi.waitFor(() => expect(server.hub.runner.state(a)).toBe("stopped"), { timeout: 2000 })
      // The runner itself refuses, on its launch path: A, and B (over through A).
      await expect(server.hub.runner.ensure(ada.spec(a))).rejects.toBeInstanceOf(OverQuotaError)
      await expect(server.hub.runner.ensure(ada.spec(b))).rejects.toBeInstanceOf(OverQuotaError)
      const page = (await ada.person.get("/projects")).body.toString()
      expect(page).toContain("stopped: over the disk limit")
      expect(page).toContain("at most 20000 files and folders")
      expect(page.indexOf("Amp")).toBeLessThan(page.indexOf("Bus"))
      expect(page).not.toContain(`href="/p/${a}/"`)
      // Deleting the files in A frees both (once the cached measurement is gone).
      await rm(join(ada.spec(a).projectDir, "big.bin"))
      forgetMeasurement(server.hub, ada.userId)
      await server.hub.runner.ensure(ada.spec(b))
      expect(server.hub.runner.state(b)).toBe("running")
    } finally {
      await server.close()
    }
  })

  test("one user's failing measurement stops that user's workspaces and the sweep goes on to the next user", async () => {
    const server = await startTestHub({ maxBytes: 10_000, quotaSweepMs: 60_000 })
    try {
      const ada = await userWithProjects(server, "ada@example.com", ["Amp"])
      const bob = await userWithProjects(server, "bob@example.com", ["Bus"])
      await server.hub.runner.ensure(ada.spec(ada.ids[0] as string))
      await server.hub.runner.ensure(bob.spec(bob.ids[0] as string))
      await writeFile(join(bob.spec(bob.ids[0] as string).projectDir, "big.bin"), Buffer.alloc(20_000))
      const real = server.hub.files.measureUser.bind(server.hub.files)
      server.hub.files.measureUser = async (userId, limits) => {
        if (userId === ada.userId) throw Object.assign(new Error("boom"), { code: "EIO" })
        return real(userId, limits)
      }
      const stopped = await sweepQuota(server.hub)
      expect(stopped.sort()).toEqual([ada.ids[0], bob.ids[0]].sort())
      expect(server.hub.store.auditLog(10).some((entry) => entry.event === "over-quota-stop" && entry.detail.includes("not measured"))).toBe(true)
    } finally {
      await server.close()
    }
  })

  test("measurements of one user are shared while in flight and reused for 5 s; requests to a running workspace never measure", async () => {
    const server = await startTestHub()
    try {
      const ada = await userWithProjects(server, "ada@example.com", ["Amp"])
      let walks = 0
      const real = server.hub.files.measureUser.bind(server.hub.files)
      server.hub.files.measureUser = async (userId, limits) => {
        walks += 1
        return real(userId, limits)
      }
      forgetMeasurement(server.hub, ada.userId)
      await Promise.all([measureUser(server.hub, ada.userId), measureUser(server.hub, ada.userId), measureUser(server.hub, ada.userId)])
      await measureUser(server.hub, ada.userId)
      expect(walks).toBe(1)
      forgetMeasurement(server.hub, ada.userId)
      for (let i = 0; i < 5; i += 1) await server.hub.runner.ensure(ada.spec(ada.ids[0] as string))
      expect(walks).toBe(2)
    } finally {
      await server.close()
    }
  })
})

/** A runner stub whose launches and stops the test controls. */
function stubRunner(options: { confirm?: boolean; maxPerUser?: number } = {}) {
  const launched: string[] = []
  const live = new Map<string, () => void>()
  let stopGate: Promise<void> = Promise.resolve()
  const runner = new ManagedRunner({
    log: () => undefined,
    ...(options.maxPerUser !== undefined ? { maxPerUser: options.maxPerUser } : {}),
    confirmGone: async () => options.confirm ?? true,
    launch: async (spec): Promise<Launched> => {
      launched.push(spec.id)
      let end!: () => void
      const exited = new Promise<void>((done) => (end = done))
      live.set(spec.id, end)
      return {
        address: { studio: "http://127.0.0.1:1", mcp: "http://127.0.0.1:2" },
        exited,
        stop: async () => {
          await stopGate
          end()
        },
      }
    },
  })
  return { runner, launched, live, holdStops: (gate: Promise<void>) => (stopGate = gate) }
}

const spec = (id: string, userId = "u1"): WorkspaceSpec => ({ id, userId, projectDir: `/d/${id}`, basePath: "", publicOrigin: `https://${id}.ws.localhost` })

describe("the project block lives in the runner", () => {
  test("an ensure waiting on a victim's stop, then a block, never launches", async () => {
    const stub = stubRunner({ maxPerUser: 1 })
    await stub.runner.ensure(spec("a"))
    let release!: () => void
    stub.holdStops(new Promise<void>((done) => (release = done)))
    const opening = stub.runner.ensure(spec("d"))
    await new Promise((done) => setImmediate(done))
    const blocking = stub.runner.block("d")
    release()
    await expect(opening).rejects.toBeInstanceOf(ProjectBusyError)
    await blocking
    expect(stub.launched).toEqual(["a"])
    stub.runner.unblock("d")
    await stub.runner.ensure(spec("d"))
    expect(stub.launched).toEqual(["a", "d"])
  })

  test("a crash restart of an over-quota or blocked project does not happen", async () => {
    const stub = stubRunner()
    let overQuota = false
    stub.runner.setStartCheck(async () => {
      if (overQuota) throw new OverQuotaError()
    })
    await stub.runner.ensure(spec("a"))
    overQuota = true
    stub.live.get("a")?.()
    await vi.waitFor(() => expect(stub.runner.state("a")).toBe("stopped"))
    expect(stub.launched).toEqual(["a"])
    overQuota = false
    // Blocked while it crashes: the block's stop wins and nothing relaunches.
    await stub.runner.ensure(spec("b"))
    stub.live.get("b")?.()
    await stub.runner.block("b")
    await new Promise((done) => setTimeout(done, 20))
    expect(stub.launched.filter((id) => id === "b").length).toBeLessThanOrEqual(2)
    expect(stub.runner.state("b")).toBe("stopped")
  })

  test("withProjectLock stops the workspace first, refuses starts until it ends, and releases on errors", async () => {
    const stub = stubRunner()
    await stub.runner.ensure(spec("a"))
    let release!: () => void
    const gate = new Promise<void>((done) => (release = done))
    const locked = withProjectLock({ runner: stub.runner }, "a", async () => {
      expect(stub.runner.state("a")).toBe("stopped")
      await gate
    })
    await vi.waitFor(() => expect(stub.runner.state("a")).toBe("stopped"))
    await expect(stub.runner.ensure(spec("a"))).rejects.toBeInstanceOf(ProjectBusyError)
    await expect(withProjectLock({ runner: stub.runner }, "a", async () => undefined)).rejects.toBeInstanceOf(ProjectBusyError)
    release()
    await locked
    await expect(withProjectLock({ runner: stub.runner }, "a", async () => Promise.reject(new Error("disk")))).rejects.toThrow("disk")
    await stub.runner.ensure(spec("a"))
    expect(stub.runner.state("a")).toBe("running")
  })

  test("a stop the engine cannot confirm refuses the work and releases the block", async () => {
    const stub = stubRunner({ confirm: false })
    let ran = false
    await expect(withProjectLock({ runner: stub.runner }, "a", async () => void (ran = true))).rejects.toBeInstanceOf(StopUnconfirmedError)
    expect(ran).toBe(false)
    await stub.runner.ensure(spec("a"))
  })

  test("canStart refuses a user over quota", async () => {
    const server = await startTestHub({ maxBytes: 10 })
    try {
      const ada = await userWithProjects(server, "ada@example.com", ["Amp"])
      await writeFile(join(ada.spec(ada.ids[0] as string).projectDir, "x"), "more than ten bytes")
      forgetMeasurement(server.hub, ada.userId)
      await expect(canStart(server.hub, ada.spec(ada.ids[0] as string))).rejects.toBeInstanceOf(OverQuotaError)
    } finally {
      await server.close()
    }
  })
})

describe("measuring while a workspace runs", () => {
  test("a folder swapped for a link mid-measurement discards the measurement and reports nothing from outside", async () => {
    const base = await mkdtemp(join(tmpdir(), "cf-measure-"))
    const root = join(base, "project")
    const outside = join(base, "outside")
    await mkdir(join(root, "a"), { recursive: true })
    await writeFile(join(root, "a", "f"), "x")
    await mkdir(outside)
    await writeFile(join(outside, "host.bin"), Buffer.alloc(5000))
    let calls = 0
    const measured = await measureTree(root, {
      now: () => {
        calls += 1
        // While "a" is being read (its entry f is visited), the container swaps "a" for a link out.
        if (calls === 3) {
          rmSync(join(root, "a"), { recursive: true })
          symlinkSync(outside, join(root, "a"), "junction")
        }
        return 0
      },
    })
    expect(measured).toEqual({ failed: "a folder moved outside the project while it was measured" })
  })

  test("entries count toward a cap, '..x' is a folder inside, and a download listing refuses a huge tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-measure-"))
    await mkdir(join(root, "..x"))
    await writeFile(join(root, "..x", "f"), "abc")
    expect(await measureTree(root)).toEqual({ bytes: 3 })
    expect(await measureTree(root, { maxEntries: 1 })).toEqual({ failed: "more than 1 entries" })
    expect(isInside(root, join(root, "..x"))).toBe(true)
    expect(isInside(root, join(root, ".."))).toBe(false)
    await expect(walkProject(root, () => undefined, 1)).rejects.toBeInstanceOf(TooManyEntriesError)
  })
})
