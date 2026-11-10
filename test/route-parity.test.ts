import { afterEach, expect, test, vi } from "vitest"
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveCircuit } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import type { RouteScope } from "../src/engine/router/route-board.js"
import { autoroute } from "../src/mcp/route-tools.js"
import type { DesignBuilder } from "../src/studio/live.js"
import type { RouteEvent } from "../src/studio/route-events.js"
import type { Studio } from "../src/studio/server.js"
import { retryLostConnect, startReachableStudio } from "./helpers/reachable-studio.js"

const CAN_FOLDER = join(import.meta.dirname, "fixtures", "can-module")
const FILE = "can-module.circuit.tsx"
const LAYOUT = "can-module.circuit.layout.json"
const build = async (root: string, file: string) => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file)
const builder: DesignBuilder = { build }

let studio: Studio | undefined

afterEach(async () => {
  await studio?.close()
  studio = undefined
})

async function copyOfCan(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cf-route-parity-"))
  await cp(CAN_FOLDER, root, { recursive: true })
  return root
}

/** The layout file's records as written, without the file's meta line. */
const records = async (root: string) => (await readFile(join(root, LAYOUT), "utf8")).trim().split("\n").filter((line) => !line.includes('"t":"meta"'))

/** Routes the CAN board through the Studio's runner, in the server process, and returns the records it wrote. */
async function viaStudio(scope: RouteScope): Promise<string[]> {
  const root = await copyOfCan()
  await mkdir(join(root, "static"))
  await writeFile(join(root, "static", "index.html"), "<html></html>")
  const open = await startReachableStudio({ root, staticDir: join(root, "static"), builder, routeWorker: null })
  studio = open
  const headers = { "x-copperflow-token": open.token, "content-type": "application/json" }
  const events: RouteEvent[] = []
  const stream = await retryLostConnect(() => fetch(`${open.url}/api/events`, { headers }))
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
        if (/^event: route$/m.test(block)) events.push(JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? "{}") as RouteEvent)
      }
    }
  })()
  const started = await retryLostConnect(() => fetch(`${open.url}/api/route`, { method: "POST", headers, body: JSON.stringify({ file: FILE, scope }) }))
  expect(started.status).toBe(202)
  await vi.waitFor(() => expect(events.some((event) => ["done", "discarded", "cancelled", "failed"].includes(event.state))).toBe(true), { timeout: 30_000 })
  await reader.cancel()
  expect(events.at(-1)).toMatchObject({ state: "done", entryId: "c0001" })
  return records(root)
}

/** Routes the CAN board through the agent's autoroute tool and returns the records it wrote. */
async function viaAgent(input: { nets?: string[] }): Promise<string[]> {
  const root = await copyOfCan()
  const answer = await autoroute({ root, engine: { build } as never }, { file: FILE, ...input, budgetSeconds: 300 })
  expect(answer).toMatch(/^Change c0001: Routed /)
  return records(root)
}

test("the Studio's runner and the agent's autoroute make the same edits on the CAN board, all of it or some nets", async () => {
  const all = await viaStudio({ kind: "all" })
  expect(all.length).toBeGreaterThan(10)
  expect(all).toEqual(await viaAgent({}))
  await studio?.close()
  studio = undefined
  const nets = ["CANH", "CANL", "GND"]
  const some = await viaStudio({ kind: "nets", nets })
  expect(some.length).toBeGreaterThan(0)
  expect(some).toEqual(await viaAgent({ nets }))
}, 120_000)
