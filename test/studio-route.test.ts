import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { EventEmitter } from "node:events"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lockParts } from "../src/core/annotations.js"
import { inProjectQueue } from "../src/core/file-writes.js"
import { loadCircuit, resolveCircuit, updateAnnotations } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { routeBoard } from "../src/engine/router/route-board.js"
import { applyLayoutEdits } from "../src/core/layout-edits.js"
import type { CanvasLoader } from "../src/engine/fab/picture/png.js"
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
/** What a test that exports gets: the work is small without the pictures, but a loaded machine under coverage is slow at everything. */
const EXPORT_TEST_MS = 120_000
/**
 * The canvas package as if it were not installed: an export then leaves out the board's two 1600 px pictures. The
 * tests that use it prove when an export runs, not what is in it, and with the pictures one export took 13 to 25 s
 * under coverage on a loaded machine, against the 30 s these tests were given.
 */
const noCanvas = (): never => {
  throw Object.assign(new Error("Cannot find package '@napi-rs/canvas'"), { code: "ERR_MODULE_NOT_FOUND" })
}
/** Builds in this process; while `slow` is set, a build first says it began and waits for `release`. */
const pace = { slow: false, began: (): void => undefined, release: Promise.resolve() }
const builder: DesignBuilder = {
  build: async (root, file) => {
    if (pace.slow) {
      pace.began()
      await pace.release
    }
    return buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file)
  },
}

let root: string
let studio: Studio
let events: RouteEvent[]
let stopEvents: () => void

async function open(routeWorker?: RouteWorkerFactory | null, canvas?: CanvasLoader) {
  studio = await startReachableStudio({ root, staticDir: join(root, "static"), builder, ...(routeWorker === undefined ? {} : { routeWorker }), ...(canvas ? { canvas } : {}) })
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
  pace.slow = false
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
  await vi.waitFor(() => expect(events.some((event) => ["done", "discarded", "cancelled", "failed"].includes(event.state))).toBe(true), { timeout: 60_000 })
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

  test("Export → Fabrication files waits for no route: while one runs it is a 409, and it exports once the run ends", async () => {
    const silent = fakeWorker(() => undefined)
    await open(silent.factory, noCanvas)
    await data(await api("/api/route", { file: FILE, scope: { kind: "all" } }))
    const during = await api("/api/export", { file: FILE })
    expect(during.status).toBe(409)
    expect((await during.json()).error).toBe(`The board of ${FILE} is being routed; cancel it or wait for it to end before exporting`)
    expect(await readFile(join(root, "main-fab.zip")).catch(() => undefined)).toBeUndefined()
    await data(await api("/api/route/cancel", {}))
    await ended()
    expect((await data(await api("/api/export", { file: FILE }))).zip).toBe("main-fab.zip")
  }, EXPORT_TEST_MS)

  test("Export → Fabrication files runs in the project's write queue, so it waits for a write in progress", async () => {
    await open(null, noCanvas)
    let release = (): void => undefined
    const held = inProjectQueue(root, () => new Promise<void>((done) => (release = done)))
    let finished = false
    const exported = api("/api/export", { file: FILE }).then((response) => {
      finished = true
      return response
    })
    await new Promise((done) => setTimeout(done, 300))
    expect(finished).toBe(false)
    expect(await readFile(join(root, "main-fab.zip")).catch(() => undefined)).toBeUndefined()
    release()
    await held
    expect((await exported).status).toBe(200)
    expect((await readFile(join(root, "main-fab.zip"))).subarray(0, 2).toString()).toBe("PK")
  }, EXPORT_TEST_MS)

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

  test("a rules.yaml or sub-sheet change while it runs discards the result too", async () => {
    for (const [name, text, what] of [
      ["rules.yaml", "fabrication:\n  minHoleToHole: 0.3\n", "rules"],
      ["Block.sheet.tsx", "export default () => <sheet />\n", "sheet"],
    ] as const) {
      const changing = fakeWorker(async (request, reply) => {
        await writeFile(join(root, name), text)
        reply({ type: "done", report: routeBoard(request.input, { scope: request.scope }) })
      })
      await open(changing.factory)
      await data(await api("/api/route", { file: FILE, scope: { kind: "all" } }))
      expect([what, await ended()]).toEqual([what, { file: FILE, state: "discarded", reason: "A file the circuit is built from (a sub-sheet, a part or rules.yaml) changed while the board was routed, so the result was discarded; route again" }])
      expect(await records()).toEqual([])
      stopEvents()
      await studio.close()
    }
    await open(null)
  }, 60_000)

  test("a hand edit queued before the run's write gets in first, and the run is discarded, not written on top", async () => {
    const hand = { kind: "addTrack", layer: "top", width: 0.25, points: [{ x: -6, y: 5 }, { x: -4, y: 5 }] } as const
    const racing = fakeWorker(async (request, reply) => {
      // Waits in the write queue for its design while the run's own write queues behind it.
      void applyLayoutEdits(root, FILE, [{ ...hand, points: [...hand.points] }], { author: "human", summary: "Add track", design: async () => (await new Promise((done) => setTimeout(done, 300)), builder.build(root, FILE)) })
      reply({ type: "done", report: routeBoard(request.input, { scope: request.scope }) })
    })
    await open(racing.factory)
    await data(await api("/api/route", { file: FILE, scope: { kind: "all" } }))
    expect(await ended()).toEqual({ file: FILE, state: "discarded", reason: "The layout file changed while the board was routed, so the result was discarded; route again" })
    expect((await records()).map((record) => record.by)).toEqual(["human"])
  }, 30_000)

  test("a cancel that comes once the write is under way is too late: the run ends done", async () => {
    let release = (): void => undefined
    const began = new Promise<void>((done) => (pace.began = done))
    pace.release = new Promise<void>((done) => (release = done))
    const slowWrite = fakeWorker((request, reply) => {
      pace.slow = true
      reply({ type: "done", report: routeBoard(request.input, { scope: request.scope }) })
    })
    await open(slowWrite.factory)
    await data(await api("/api/route", { file: FILE, scope: { kind: "all" } }))
    await began
    expect(await data(await api("/api/route/cancel", {}))).toEqual({ cancelled: false })
    release()
    expect(await ended()).toMatchObject({ state: "done", routed: 2, entryId: "c0001" })
    expect(events.some((event) => event.state === "cancelled")).toBe(false)
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

  test("a net, part or instance the circuit does not have is refused with its names, and nothing runs", async () => {
    await open(null)
    for (const [scope, error] of [
      [{ kind: "nets", nets: ["A", "NOPE", "ALSO_NOT"] }, "The circuit has no nets NOPE, ALSO_NOT. Nothing was routed."],
      [{ kind: "parts", parts: ["R1", "U9"] }, "The circuit has no part U9. Nothing was routed."],
      [{ kind: "instance", instance: "PS7" }, "The circuit has no sub-sheet instance PS7. Nothing was routed."],
    ] as const) {
      const refused = await api("/api/route", { file: FILE, scope })
      expect([scope.kind, refused.status]).toEqual([scope.kind, 400])
      expect((await refused.json()).error).toBe(error)
    }
    expect(events).toEqual([])
    expect(await data(await api("/api/route", { file: FILE, scope: { kind: "nets", nets: ["A"] } }))).toMatchObject({ status: "routing" })
    expect(await ended()).toMatchObject({ state: "done", routed: 1, total: 1 })
  }, 30_000)

  test("a lock added while the run waits in the write queue is honoured: no track starts on the part, and the run is written", async () => {
    const locking = fakeWorker(async (request, reply) => {
      // Holds the write queue a moment, and queues a lock of every part behind it, both before the run's write.
      void inProjectQueue(root, () => new Promise((done) => setTimeout(done, 300)))
      void updateAnnotations(root, FILE, (a) => lockParts(a, model, ["R1", "R2", "R3", "R4"], new Date().toISOString()))
      reply({ type: "done", report: routeBoard(request.input, { scope: request.scope }) })
    })
    const { model } = await loadCircuit(root, FILE)
    await open(locking.factory)
    await data(await api("/api/route", { file: FILE, scope: { kind: "all" } }))
    expect(await ended()).toMatchObject({ state: "done", routed: 2, entryId: "c0001" })
    const design = await builder.build(root, FILE)
    const pads = design.pcb.parts.flatMap((part) => part.pads)
    for (const track of design.pcb.tracks) {
      const start = track.points[0]!
      expect(pads.some((pad) => Math.hypot(pad.x - start.x, pad.y - start.y) < 0.3)).toBe(false)
    }
    expect(design.pcb.ratsnest).toEqual([])
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

  test("a router track on a part locked since routing is left and named; the rest goes", async () => {
    await open(null)
    await data(await api("/api/route", { file: FILE, scope: { kind: "all" } }))
    await ended()
    await data(await api("/api/lock", { file: FILE, parts: ["R1", "R2", "R3", "R4"], locked: true }))
    const done = await data(await api("/api/unroute", { file: FILE }))
    expect(done.summary).toMatch(/^Unroute: remove .* the router made; left t\d{4} \(starts on the locked part R\d\)/)
    const left = await records()
    expect(left.length).toBeGreaterThan(0)
    expect(left.every((record) => record.t === "track")).toBe(true)
  }, 30_000)

  test("a router track reshaped by hand is the person's: Unroute leaves it", async () => {
    await open(null)
    await data(await api("/api/route", { file: FILE, scope: { kind: "nets", nets: ["A"] } }))
    await ended()
    const [first] = (await records()).filter((record) => record.t === "track")
    await data(await api("/api/layout", { file: FILE, summary: "Reshape", edits: [{ kind: "setTrack", id: first!.id, width: 0.3 }] }))
    await api("/api/unroute", { file: FILE })
    expect((await records()).filter((record) => record.id === first!.id).map((record) => record.by)).toEqual(["human"])
  }, 30_000)
})
