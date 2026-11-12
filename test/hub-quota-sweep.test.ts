import { describe, expect, test, vi } from "vitest"
import { rmSync, symlinkSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkBeforeStart, OverQuotaError, ProjectBusyError, sweepQuota, withProjectLock } from "../src/hub/quota.js"
import { measureTree } from "../src/hub/safe-files.js"
import type { HubServer } from "../src/hub/server.js"
import { newUser, projectOriginOf, startTestHub } from "./helpers/hub-client.js"

async function userWithProjects(server: HubServer, email: string, names: string[]) {
  const person = await newUser(server, email)
  for (const name of names) await person.submit("/projects", "/projects", { name })
  const userId = server.hub.store.userByEmail(email)?.id as string
  const ids = server.hub.store.projects(userId).map((project) => project.id)
  const spec = (id: string) => ({ id, userId, projectDir: server.hub.files.projectDir(userId, id), basePath: "", publicOrigin: projectOriginOf(id) })
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
      await expect(checkBeforeStart(server.hub, ada.userId, a)).rejects.toBeInstanceOf(OverQuotaError)
      // Over through A: B cannot start either.
      await expect(checkBeforeStart(server.hub, ada.userId, b)).rejects.toBeInstanceOf(OverQuotaError)
      const page = (await ada.person.get("/projects")).body.toString()
      expect(page).toContain("stopped: over the disk limit")
      expect(page.indexOf("Amp")).toBeLessThan(page.indexOf("Bus"))
      expect(page).not.toContain(`href="/p/${a}/"`)
      // Deleting the files in A frees both.
      await rm(join(ada.spec(a).projectDir, "big.bin"))
      await checkBeforeStart(server.hub, ada.userId, a)
      await checkBeforeStart(server.hub, ada.userId, b)
      expect((await ada.person.get("/projects")).body.toString()).toContain(`href="/p/${b}/"`)
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
      server.hub.files.measureUser = async (userId: string) => {
        if (userId === ada.userId) throw Object.assign(new Error("boom"), { code: "EIO" })
        return real(userId)
      }
      const stopped = await sweepQuota(server.hub)
      expect(stopped.sort()).toEqual([ada.ids[0], bob.ids[0]].sort())
      expect(server.hub.store.auditLog(10).some((entry) => entry.event === "over-quota-stop" && entry.detail.includes("not measured"))).toBe(true)
    } finally {
      await server.close()
    }
  })
})

describe("the project lock", () => {
  test("a download stops the running workspace first and no start is allowed until it ends; the lock is released on errors", async () => {
    const server = await startTestHub()
    try {
      const ada = await userWithProjects(server, "ada@example.com", ["Amp"])
      const id = ada.ids[0] as string
      await server.hub.runner.ensure(ada.spec(id))
      let release!: () => void
      const gate = new Promise<void>((done) => (release = done))
      const locked = withProjectLock(server.hub, id, async () => {
        expect(server.hub.runner.state(id)).toBe("stopped")
        await gate
      })
      await vi.waitFor(() => expect(server.hub.runner.state(id)).toBe("stopped"))
      await expect(checkBeforeStart(server.hub, ada.userId, id)).rejects.toBeInstanceOf(ProjectBusyError)
      await expect(withProjectLock(server.hub, id, async () => undefined)).rejects.toBeInstanceOf(ProjectBusyError)
      release()
      await locked
      await checkBeforeStart(server.hub, ada.userId, id)
      await expect(withProjectLock(server.hub, id, async () => Promise.reject(new Error("disk")))).rejects.toThrow("disk")
      await checkBeforeStart(server.hub, ada.userId, id)
      // Through the route: the download stops the running workspace.
      await server.hub.runner.ensure(ada.spec(id))
      const answer = await ada.person.get(`/projects/${id}/download`)
      expect(answer.status).toBe(200)
      expect(server.hub.runner.state(id)).toBe("stopped")
    } finally {
      await server.close()
    }
  })
})

describe("measuring while a workspace runs", () => {
  test("a folder swapped for a link mid-measurement discards the measurement and reads nothing outside", async () => {
    const base = await mkdtemp(join(tmpdir(), "cf-measure-"))
    const root = join(base, "project")
    const outside = join(base, "outside")
    await mkdir(join(root, "a"), { recursive: true })
    await mkdir(join(root, "z"))
    await mkdir(outside)
    await writeFile(join(outside, "host.bin"), Buffer.alloc(5000))
    let calls = 0
    const measured = await measureTree(root, {
      now: () => {
        calls += 1
        // While the root's entries are visited, after "a" was queued: the container swaps "a" for a link out.
        if (calls === 3) {
          rmSync(join(root, "a"), { recursive: true })
          symlinkSync(outside, join(root, "a"), "junction")
        }
        return 0
      },
    })
    expect(measured).toEqual({ failed: "a folder moved outside the project while it was measured" })
    expect(await measureTree(root, { maxEntries: 1 })).toEqual({ failed: "more than 1 entries" })
  })
})
