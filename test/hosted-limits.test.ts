import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { HOSTED_WORKER_HEAP_MB, LOCAL_WORKER_HEAP_MB, useHostedWorkerHeap, workerHeap } from "../src/engine/worker-env.js"
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

  test("the data directory is checked at start for what a --mount value cannot hold", () => {
    expect(() => checkDataDirForMounts("relative/data")).toThrow(/absolute/)
    expect(() => checkDataDirForMounts(process.platform === "win32" ? "C:\\data,x" : "/data,x")).toThrow(/comma/)
    checkDataDirForMounts(process.platform === "win32" ? "C:\\srv\\copperflow" : "/srv/copperflow")
  })
})
