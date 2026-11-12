import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { mkdtemp, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { HOSTED_UMASK, HOSTED_WORKER_HEAP_MB, LOCAL_WORKER_HEAP_MB, useHostedWorkerHeap, workerHeap } from "../src/engine/worker-env.js"
import { ProjectFiles } from "../src/hub/projects.js"
import { checkDataDirForMounts } from "../src/hub/runner/container-runner.js"

describe("memory and paths in a hosted workspace", () => {
  test("workers get 256 MB in a hosted workspace, and the image starts the main thread with 160 MB", () => {
    expect(workerHeap()).toBe(LOCAL_WORKER_HEAP_MB)
    useHostedWorkerHeap()
    expect(workerHeap()).toBe(HOSTED_WORKER_HEAP_MB)
    expect(HOSTED_WORKER_HEAP_MB).toBe(256)
    const dockerfile = readFileSync(fileURLToPath(new URL("../deploy/workspace.Dockerfile", import.meta.url)), "utf8")
    expect(dockerfile).toContain('ENTRYPOINT ["node", "--max-old-space-size=160", "/app/dist/cli.js", "workspace"]')
    expect(dockerfile).toContain('LABEL org.copperflow.base="${NODE_IMAGE}"')
    expect(dockerfile).toContain("HOME=/tmp")
  })

  test("a hosted workspace's umask leaves group read and write, nothing for others", () => {
    expect(HOSTED_UMASK).toBe(0o007)
    const cli = readFileSync(fileURLToPath(new URL("../src/cli-commands.ts", import.meta.url)), "utf8")
    expect(cli).toContain("process.umask(HOSTED_UMASK)")
  })

  test.skipIf(process.platform === "win32" || !process.getgid)("project folders get the workspace group and mode 2770, nothing else does", async () => {
    const data = await mkdtemp(join(tmpdir(), "cf-group-"))
    const files = new ProjectFiles(data)
    files.workspaceGroup = process.getgid?.() as number
    const dir = await files.create("a".repeat(32), "b".repeat(32))
    const info = await stat(dir)
    expect(info.mode & 0o7777).toBe(0o2770)
    expect(info.gid).toBe(process.getgid?.())
    expect((await stat(files.userDir("a".repeat(32)))).mode & 0o777).toBe(0o700)
  })

  test("the data directory is checked at start for what a --mount value cannot hold", () => {
    expect(() => checkDataDirForMounts("relative/data")).toThrow(/absolute/)
    expect(() => checkDataDirForMounts(process.platform === "win32" ? "C:\\data,x" : "/data,x")).toThrow(/comma/)
    checkDataDirForMounts(process.platform === "win32" ? "C:\\srv\\copperflow" : "/srv/copperflow")
  })
})
