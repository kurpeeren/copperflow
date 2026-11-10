import { describe, expect, test } from "vitest"
import { build } from "esbuild"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Worker } from "node:worker_threads"
import { buildDesign } from "../src/engine/design.js"
import type { RouteWorkerReply, RouteWorkerRequest } from "../src/studio/route-runner.js"

const MAIN = "main.circuit.tsx"
const resistor = (name: string, x: number, y: number, extra = "") => `    <resistor name="${name}" resistance="1k" footprint="0603" pcbX={${x}} pcbY={${y}} ${extra}/>`
const CROSS = `export default () => (
  <board width="14mm" height="12mm">
${[resistor("R1", -5.5, 0), resistor("R2", 5.5, 0), resistor("R3", 0, -4.5, "pcbRotation={90} "), resistor("R4", 0, 4.5, "pcbRotation={90} ")].join("\n")}
    <trace from="R1.pin2" to="net.A" />
    <trace from="R2.pin1" to="net.A" />
    <trace from="R3.pin2" to="net.B" />
    <trace from="R4.pin1" to="net.B" />
  </board>
)
`

describe("the router worker file", () => {
  test("runs in a real worker thread: progress as it routes, then the report", async () => {
    // The worker's own source, bundled as the build would emit it, so the test needs no prior build.
    const out = join(await mkdtemp(join(tmpdir(), "cf-worker-")), "router-worker.mjs")
    await build({ entryPoints: [fileURLToPath(new URL("../src/studio/router-worker.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", outfile: out, logLevel: "silent" })
    const design = buildDesign({ [MAIN]: CROSS }, MAIN)
    const worker = new Worker(out)
    const replies: RouteWorkerReply[] = []
    const done = new Promise<void>((finish, fail) => {
      worker.on("message", (reply: RouteWorkerReply) => {
        replies.push(reply)
        if (reply.type !== "progress") finish()
      })
      worker.on("error", fail)
    })
    const request: RouteWorkerRequest = { input: { layout: design.pcb, rules: design.rules, nets: design.circuit.nets, components: design.circuit.components }, scope: { kind: "all" } }
    worker.postMessage(request)
    await done
    await worker.terminate()
    const last = replies.at(-1)
    expect(last?.type).toBe("done")
    expect(last?.type === "done" && last.report.routed.length).toBe(2)
    expect(replies.filter((reply) => reply.type === "progress").at(-1)).toEqual({ type: "progress", progress: { stage: "cleanup", capped: false } })
  }, 30_000)
})
