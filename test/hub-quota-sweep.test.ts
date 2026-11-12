import { describe, expect, test, vi } from "vitest"
import { rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { checkQuotaBeforeStart, OVER_QUOTA_MESSAGE, OverQuotaError } from "../src/hub/quota.js"
import { newUser, projectOriginOf, startTestHub } from "./helpers/hub-client.js"

describe("the disk quota while a workspace runs", () => {
  test("a workspace whose folder grows past the quota is stopped within one sweep, cannot be reopened, and opens again after files are removed", async () => {
    const server = await startTestHub({ maxBytes: 10_000, quotaSweepMs: 50 })
    try {
      const ada = await newUser(server, "ada@example.com")
      await ada.submit("/projects", "/projects", { name: "Amp" })
      const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
      const projectId = server.hub.store.projects(userId)[0]?.id as string
      const dir = server.hub.files.projectDir(userId, projectId)
      const spec = { id: projectId, userId, projectDir: dir, basePath: "", publicOrigin: projectOriginOf(projectId) }
      await server.hub.runner.ensure(spec)
      expect(server.hub.runner.state(projectId)).toBe("running")
      // The workspace writes past the quota.
      await writeFile(join(dir, "big.bin"), Buffer.alloc(20_000))
      await vi.waitFor(() => expect(server.hub.runner.state(projectId)).toBe("stopped"), { timeout: 2000 })
      expect(server.hub.store.overQuota(projectId)).toBe(true)
      await expect(checkQuotaBeforeStart(server.hub, userId, projectId)).rejects.toBeInstanceOf(OverQuotaError)
      const page = (await ada.get("/projects")).body.toString()
      expect(page).toContain("stopped: over the disk limit")
      expect(page).toContain(OVER_QUOTA_MESSAGE.slice(0, 40))
      expect(page).not.toContain(`href="/p/${projectId}/"`)
      // Removing the files clears it.
      await rm(join(dir, "big.bin"))
      await checkQuotaBeforeStart(server.hub, userId, projectId)
      expect(server.hub.store.overQuota(projectId)).toBe(false)
      expect((await ada.get("/projects")).body.toString()).toContain(`href="/p/${projectId}/"`)
    } finally {
      await server.close()
    }
  })
})
