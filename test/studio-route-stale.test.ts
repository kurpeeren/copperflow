import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveCircuit } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import type { DesignBuilder } from "../src/studio/live.js"
import type { Studio } from "../src/studio/server.js"
import { retryLostConnect, startReachableStudio } from "./helpers/reachable-studio.js"

// The Studio's file watcher is held back: it reports nothing, as a watcher that has not yet seen a write.
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>()
  return { ...fs, watch: () => Object.assign(new EventEmitter(), { close: () => undefined }) }
})

const FILE = "main.circuit.tsx"
const LAYOUT = "main.circuit.layout.json"
const resistor = (name: string, x: number, y: number, extra = "") => `    <resistor name="${name}" resistance="1k" footprint="0603" pcbX={${x}} pcbY={${y}} ${extra}/>`
/** Two nets that cross: R1 to R2 (A) and R3 to R4 (B). */
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
const builder: DesignBuilder = { build: async (root, file) => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file) }

let root: string
let studio: Studio

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-route-stale-"))
  await mkdir(join(root, "static"))
  await writeFile(join(root, "static", "index.html"), "<html></html>")
  await writeFile(join(root, FILE), CROSS)
  studio = await startReachableStudio({ root, staticDir: join(root, "static"), builder, routeWorker: null })
})

afterEach(async () => {
  await studio.close()
})

function api(path: string, body?: unknown) {
  return retryLostConnect(() =>
    fetch(`${studio.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-copperflow-token": studio.token, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
}

const json = async (response: Response) => ((await response.json()) as { data: any }).data
const records = async () => (await readFile(join(root, LAYOUT), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { t?: string; net?: string; by: string }).filter((record) => record.t !== "meta")

test("a layout write the watcher has not yet counted is routed against, not over: the run builds from the files it hashed", async () => {
  // The Studio's build of the board is done and, with the watcher silent, still counts as current.
  await api("/api/build", { file: FILE })
  await vi.waitFor(async () => expect((await json(await api(`/api/build?file=${FILE}`))).status).toBe("done"), { timeout: 20_000 })
  // Another process (the agent's route_track) joins net A by hand, straight along y = 0.
  const plain = await builder.build(root, FILE)
  const pad = (id: string) => plain.pcb.parts.flatMap((part) => part.pads).find((one) => one.id === id)!
  const [from, to] = [pad("R1#2"), pad("R2#1")]
  const hand = { t: "track", id: "t0001", net: "net.A", layer: "top", width: 0.25, points: [{ x: from.x, y: from.y }, { x: to.x, y: to.y }], locked: false, by: "agent" }
  await writeFile(join(root, LAYOUT), `${JSON.stringify(hand)}\n`)
  const events: { state: string; routed?: number; total?: number }[] = []
  const stream = await api("/api/events")
  const reader = stream.body!.pipeThrough(new TextDecoderStream()).getReader()
  void (async () => {
    let buffer = ""
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }))
      if (done) return
      buffer += value
      for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
        const block = buffer.slice(0, end)
        buffer = buffer.slice(end + 2)
        if (/^event: route$/m.test(block)) events.push(JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? "{}"))
      }
    }
  })()
  expect((await api("/api/route", { file: FILE, scope: { kind: "all" } })).status).toBe(202)
  await vi.waitFor(() => expect(events.some((event) => ["done", "discarded", "cancelled", "failed"].includes(event.state))).toBe(true), { timeout: 20_000 })
  await reader.cancel()
  // Only net B was left to route; the hand track stays and nothing is laid over it.
  expect(events.at(-1)).toMatchObject({ state: "done", routed: 1, total: 1 })
  const written = await records()
  expect(written[0]).toMatchObject({ id: "t0001", by: "agent" })
  expect(written.slice(1).every((record) => record.by === "router" && record.net === "net.B")).toBe(true)
  const after = await builder.build(root, FILE)
  expect(after.pcb.ratsnest).toEqual([])
  expect(after.violations.filter((v) => /copper|hole|via|track|short/.test(v.code))).toEqual([])
}, 30_000)
