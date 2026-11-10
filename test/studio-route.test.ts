import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveCircuit } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { routeBoard } from "../src/engine/router/route-board.js"
import type { DesignBuilder } from "../src/studio/live.js"
import type { RouteEvent } from "../src/studio/route-events.js"
import type { RouteWorker, RouteWorkerFactory, RouteWorkerReply, RouteWorkerRequest } from "../src/studio/route-runner.js"
import type { Studio } from "../src/studio/server.js"
import { retryLostConnect, startReachableStudio } from "./helpers/reachable-studio.js"

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
const builder: DesignBuilder = {
  build: async (root, file) => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file),
}

let root: string
let studio: Studio
let events: RouteEvent[]
let stopEvents: () => void

async function open(routeWorker?: RouteWorkerFactory | null) {
  studio = await startReachableStudio({ root, staticDir: join(root, "static"), builder, ...(routeWorker === undefined ? {} : { routeWorker }) })
  events = []
  const controller = new AbortController()
  stopEvents = () => controller.abort()
  const response = await retryLostConnect(() => fetch(`${studio.url}/api/events`, { headers: { "x-copperflow-token": studio.token }, signal: controller.signal }))
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  expect((await reader.read()).value).toContain(": connected")
  void (async () => {
    let buffer = ""
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += value
        for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          if (/^event: route$/m.test(block)) events.push(JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? "{}") as RouteEvent)
        }
      }
    } catch {
      // the stream was closed
    }
  })()
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-route-"))
  await mkdir(join(root, "static"))
  await writeFile(join(root, "static", "index.html"), "<html></html>")
  await writeFile(join(root, FILE), CROSS)
})

afterEach(async () => {
  stopEvents()
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

async function data(response: Response) {
  const json = (await response.json()) as { ok: boolean; data?: unknown; error?: string }
  if (!json.ok) throw new Error(`${response.status} ${json.error}`)
  return json.data as any
}

/** The run's last event once it has ended. */
async function ended(): Promise<RouteEvent> {
  await vi.waitFor(() => expect(events.some((event) => ["done", "discarded", "cancelled", "failed"].includes(event.state))).toBe(true), { timeout: 20_000 })
  return events.at(-1) as RouteEvent
}

const records = async () => (await readFile(join(root, LAYOUT), "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { t?: string; id: string; by: string }).filter((record) => record.t !== "meta")

/** A worker double: answers each request as `answer` says, after the request is sent. */
function fakeWorker(answer: (request: RouteWorkerRequest, reply: (message: RouteWorkerReply) => void) => void | Promise<void>) {
  const made: (EventEmitter & { terminated: boolean })[] = []
  const factory = (): RouteWorker => {
    const worker = Object.assign(new EventEmitter(), { terminated: false })
    made.push(worker)
    return Object.assign(worker, {
      postMessage: (request: RouteWorkerRequest) => {
        setImmediate(() => void answer(request, (message) => worker.emit("message", message)))
      },
      terminate: () => {
        worker.terminated = true
      },
    }) as unknown as RouteWorker
  }
  return { factory, made }
}

const routeInWorker = fakeWorker((request, reply) => {
  const report = routeBoard(request.input, { scope: request.scope, onProgress: (progress) => reply({ type: "progress", progress }) })
  reply({ type: "done", report })
})

describe("Route → Autoroute on the server", () => {
  test("routes the board in the server process, writes one entry by the router for a person, and undo takes the whole run back", async () => {
    await open(null)
    const started = await api("/api/route", { file: FILE, scope: { kind: "all" } })
    expect(started.status).toBe(202)
    expect(await data(started)).toEqual({ status: "routing", file: FILE })
    const last = await ended()
    expect(last).toMatchObject({ file: FILE, state: "done", routed: 2, total: 2, unrouted: [], cleanupCapped: false, entryId: "c0001", writeMark: expect.any(Number) })
    expect(events[0]).toEqual({ file: FILE, state: "started", scope: { kind: "all" }, inProcess: true })
    expect(events.some((event) => event.state === "running")).toBe(true)
    expect(events.at(-2)).toEqual({ file: FILE, state: "cleanup", capped: false })
    const written = await records()
    expect(written.length).toBeGreaterThan(1)
    expect(written.every((record) => record.by === "router")).toBe(true)
    const history = (await data(await api("/api/history"))).entries
    expect(history).toHaveLength(1)
    expect(history[0]).toMatchObject({ id: "c0001", file: LAYOUT, author: "human", summary: "Autoroute the board: 2 of 2 connections" })
    expect((await builder.build(root, FILE)).pcb.ratsnest).toEqual([])
    await data(await api("/api/undo", {}))
    expect(await records()).toEqual([])
    expect((await builder.build(root, FILE)).pcb.ratsnest).toHaveLength(2)
  }, 30_000)

  test("in a worker: progress comes as it routes, and the scope goes with the board", async () => {
    await open(routeInWorker.factory)
    await data(await api("/api/route", { file: FILE, scope: { kind: "nets", nets: ["B"] } }))
    expect(await ended()).toMatchObject({ state: "done", routed: 1, total: 1 })
    expect(events[0]).toEqual({ file: FILE, state: "started", scope: { kind: "nets", nets: ["B"] } })
    expect(events.filter((event) => event.state === "running").at(-1)).toMatchObject({ pass: expect.any(Number), done: 1, total: 1 })
    expect(routeInWorker.made.at(-1)?.terminated).toBe(true)
    expect(new Set((await readFile(join(root, LAYOUT), "utf8")).match(/"net":"[^"]+"/g))).toEqual(new Set(['"net":"net.B"']))
  }, 30_000)

  test("one run at a time; cancel ends the worker and writes nothing", async () => {
    const silent = fakeWorker(() => undefined)
    await open(silent.factory)
    await data(await api("/api/route", { file: FILE, scope: { kind: "all" } }))
    const second = await api("/api/route", { file: FILE, scope: { kind: "all" } })
    expect(second.status).toBe(409)
    expect((await second.json()).error).toContain("is being routed")
    await vi.waitFor(() => expect(silent.made).toHaveLength(1))
    expect(await data(await api("/api/route/cancel", {}))).toEqual({ cancelled: true })
    expect(await ended()).toEqual({ file: FILE, state: "cancelled" })
    expect(silent.made[0]?.terminated).toBe(true)
    expect(await records()).toEqual([])
    expect(await data(await api("/api/route/cancel", {}))).toEqual({ cancelled: false })
  }, 30_000)

  test("a result computed while the circuit changed is discarded, not applied", async () => {
    const changing = fakeWorker(async (request, reply) => {
      await writeFile(join(root, FILE), CROSS.replace("pcbX={-5.5}", "pcbX={-5}"))
      reply({ type: "done", report: routeBoard(request.input, { scope: request.scope }) })
    })
    await open(changing.factory)
    await data(await api("/api/route", { file: FILE, scope: { kind: "all" } }))
    expect(await ended()).toEqual({ file: FILE, state: "discarded", reason: "The circuit changed while the board was routed, so the result was discarded; route again" })
    expect(await records()).toEqual([])
  }, 30_000)

  test("a worker that fails says why", async () => {
    await open(fakeWorker((_request, reply) => reply({ type: "error", message: "out of memory" })).factory)
    await data(await api("/api/route", { file: FILE, scope: { kind: "all" } }))
    expect(await ended()).toEqual({ file: FILE, state: "failed", error: "out of memory" })
  }, 30_000)

  test("a bad scope or a sub-sheet is refused before anything runs", async () => {
    await open(null)
    expect((await api("/api/route", { file: FILE, scope: { kind: "nets", nets: [] } })).status).toBe(400)
    expect((await api("/api/route", { file: FILE, scope: { kind: "everything" } })).status).toBe(400)
    await writeFile(join(root, "Block.sheet.tsx"), "export default () => <sheet />")
    const sheet = await api("/api/route", { file: "Block.sheet.tsx", scope: { kind: "all" } })
    expect(sheet.status).toBe(400)
    expect((await sheet.json()).error).toContain("is a sub-sheet")
    expect(await data(await api("/api/route", { file: FILE, scope: { kind: "all" } }))).toMatchObject({ status: "routing" })
    await ended()
  }, 30_000)

  test("a locked part's pad is never where a router track starts", async () => {
    await open(null)
    await data(await api("/api/lock", { file: FILE, parts: ["R1", "R2"], locked: true }))
    await data(await api("/api/route", { file: FILE, scope: { kind: "all" } }))
    expect(await ended()).toMatchObject({ state: "done", routed: 2 })
    const design = await builder.build(root, FILE)
    const lockedPads = design.pcb.parts.filter((part) => part.component === "R1" || part.component === "R2").flatMap((part) => part.pads)
    for (const track of design.pcb.tracks) {
      const start = track.points[0]!
      expect(lockedPads.some((pad) => Math.hypot(pad.x - start.x, pad.y - start.y) < 0.3)).toBe(false)
    }
    expect(design.pcb.ratsnest).toEqual([])
  }, 30_000)
})

describe("Route → Unroute on the server", () => {
  test("removes only the router's copper, all or the selected, as one entry; hand copper stays", async () => {
    await open(null)
    await data(await api("/api/route", { file: FILE, scope: { kind: "all" } }))
    await ended()
    const hand = await data(await api("/api/layout", { file: FILE, summary: "Add track", edits: [{ kind: "addTrack", layer: "top", width: 0.25, points: [{ x: -6, y: 5 }, { x: -4, y: 5 }] }] }))
    const [handTrack] = hand.created as string[]
    const refused = await api("/api/unroute", { file: FILE, ids: [handTrack] })
    expect(refused.status).toBe(400)
    expect((await refused.json()).error).toContain("Unroute removes only")
    const routerIds = (await records()).filter((record) => record.by === "router").map((record) => record.id)
    const one = await data(await api("/api/unroute", { file: FILE, ids: [routerIds[0], handTrack] }))
    expect(one.summary).toMatch(/^Unroute: remove 1 (track|via) the router made$/)
    expect((await records()).map((record) => record.id)).not.toContain(routerIds[0])
    await data(await api("/api/unroute", { file: FILE }))
    expect((await records()).map((record) => record.id)).toEqual([handTrack])
    const none = await api("/api/unroute", { file: FILE })
    expect((await none.json()).error).toBe("The board has no unlocked router copper to remove")
  }, 30_000)
})
