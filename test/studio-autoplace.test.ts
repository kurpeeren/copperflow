import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { lockParts } from "../src/core/annotations.js"
import { readEntries } from "../src/core/history.js"
import { loadCircuit, resolveCircuit, updateAnnotations } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import type { DesignBuilder } from "../src/studio/live.js"
import type { PlaceEvent } from "../src/studio/place-events.js"
import type { PlaceWorkerFactory } from "../src/studio/place-runner.js"
import type { Studio } from "../src/studio/server.js"
import { retryLostConnect, startReachableStudio } from "./helpers/reachable-studio.js"

const FILE = "main.circuit.tsx"
const SOURCE = `export default () => (
  <board width="40mm" height="30mm">
    <chip name="U1" footprint="soic8" pinLabels={{ pin1: "VCC", pin8: "GND" }} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" />
    <resistor name="R1" resistance="10k" footprint="0603" />
    <resistor name="R2" resistance="10k" footprint="0603" />
    <trace from="U1.pin1" to="net.VCC" />
    <trace from="C1.pin1" to="net.VCC" />
    <trace from="U1.pin8" to="net.GND" />
    <trace from="C1.pin2" to="net.GND" />
    <trace from="R1.pin1" to="U1.pin2" />
    <trace from="R1.pin2" to="net.VCC" />
    <trace from="R2.pin1" to="U1.pin3" />
    <trace from="R2.pin2" to="net.GND" />
  </board>
)
`
const builder: DesignBuilder = {
  build: async (root, file) => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file),
}

let root: string
let studio: Studio
let events: PlaceEvent[]
let stopEvents: () => void

async function open(placeWorker: PlaceWorkerFactory | null = null) {
  studio = await startReachableStudio({ root, staticDir: join(root, "static"), builder, routeWorker: null, placeWorker })
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
          if (/^event: place$/m.test(block)) events.push(JSON.parse(/^data: (.+)$/m.exec(block)?.[1] ?? "{}") as PlaceEvent)
        }
      }
    } catch {
      // closed
    }
  })()
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-autoplace-"))
  await mkdir(join(root, "static"))
  await writeFile(join(root, "static", "index.html"), "<html></html>")
  await writeFile(join(root, FILE), SOURCE)
})

afterEach(async () => {
  stopEvents()
  await studio.close()
})

const api = (path: string, body?: unknown) =>
  retryLostConnect(() =>
    fetch(`${studio.url}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { "x-copperflow-token": studio.token, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )

async function data(response: Response) {
  const json = (await response.json()) as { ok: boolean; data?: unknown; error?: string }
  if (!json.ok) throw new Error(`${response.status} ${json.error}`)
  return json.data as any
}

async function ended(): Promise<PlaceEvent> {
  await vi.waitFor(() => expect(events.some((e) => ["done", "discarded", "cancelled", "failed"].includes(e.state))).toBe(true), { timeout: 20_000 })
  return events.at(-1) as PlaceEvent
}

describe("POST /api/autoplace", () => {
  test("answers at once, tells its progress, and writes every unplaced part's pcbX, pcbY and pcbRotation as one human entry", async () => {
    await open()
    expect(await data(await api("/api/autoplace", { file: FILE, scope: { kind: "all" } }))).toEqual({ status: "placing", file: FILE })
    const done = await ended()
    expect(events[0]).toEqual({ file: FILE, state: "started", scope: { kind: "all" }, inProcess: true })
    expect(events.some((e) => e.state === "running" && e.stage === "construct")).toBe(true)
    expect(done).toMatchObject({ file: FILE, state: "done", placed: 4, unplaced: [], entryId: "c0001", writeMark: expect.any(Number) })
    if (done.state !== "done") throw new Error("not done")
    expect(done.wireLength).toBeLessThanOrEqual(done.before)
    const entries = await readEntries(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ author: "human", summary: "Autoplace the board: 4 parts" })
    const text = await readFile(join(root, FILE), "utf8")
    for (const part of ["U1", "C1", "R1", "R2"]) expect(text).toMatch(new RegExp(`name="${part}"[^/]*pcbX=\\{[-\\d.]+\\} pcbY=\\{[-\\d.]+\\} pcbRotation=\\{\\d+\\}`))
  })

  test("a locked part stays where it is, and the parts scope places only those named", async () => {
    const { model } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (a) => lockParts(a, model, ["R2"], new Date().toISOString()))
    await open()
    await data(await api("/api/autoplace", { file: FILE, scope: { kind: "parts", parts: ["R1", "R2"] } }))
    expect(await ended()).toMatchObject({ state: "done", placed: 1 })
    const text = await readFile(join(root, FILE), "utf8")
    expect(text).toContain('<resistor name="R2" resistance="10k" footprint="0603" />')
    expect(text).toContain('<chip name="U1" footprint="soic8" pinLabels={{ pin1: "VCC", pin8: "GND" }} />')
    expect(text).toMatch(/name="R1"[^/]*pcbX=/)
  })

  test("fit reshapes the board round the parts in the same entry", async () => {
    await open()
    await data(await api("/api/autoplace", { file: FILE, scope: { kind: "all" }, fit: true }))
    const done = await ended()
    expect(done).toMatchObject({ state: "done", board: { width: expect.any(Number), height: expect.any(Number) } })
    expect(await readEntries(root)).toHaveLength(1)
    expect(await readFile(join(root, FILE), "utf8")).not.toContain('width="40mm"')
  })

  test("refuses a part the circuit lacks; cancel stops a run and nothing is written", async () => {
    await open()
    expect((await api("/api/autoplace", { file: FILE, scope: { kind: "parts", parts: ["Q9"] } })).status).toBe(400)
    // A worker that never answers: the run waits until it is cancelled.
    const factory: PlaceWorkerFactory = () => ({ postMessage: () => undefined, on: () => undefined, terminate: () => undefined }) as never
    stopEvents()
    await studio.close()
    await open(factory)
    await data(await api("/api/autoplace", { file: FILE, scope: { kind: "all" } }))
    expect(await data(await api("/api/autoplace/cancel", {}))).toEqual({ cancelled: true })
    expect(await ended()).toEqual({ file: FILE, state: "cancelled" })
    expect(await readEntries(root)).toEqual([])
  })

  test("a file changed while the board was placed discards the result", async () => {
    let answer: (() => void) | undefined
    const factory: PlaceWorkerFactory = () => {
      const listeners: ((reply: unknown) => void)[] = []
      return {
        postMessage: () => {
          answer = () => listeners.forEach((l) => l({ type: "done", placement: { positions: new Map([["R1", { x: 1, y: 1, rotation: 0 }]]), score: { wireLength: 1, edgeTouches: 0 }, before: { wireLength: 2 }, moved: ["R1"], unplaced: [], notes: [], budgetSpent: false } }))
        },
        on: (event: string, listener: (reply: unknown) => void) => {
          if (event === "message") listeners.push(listener)
        },
        terminate: () => undefined,
      } as never
    }
    await open(factory)
    await data(await api("/api/autoplace", { file: FILE, scope: { kind: "all" } }))
    await vi.waitFor(() => expect(answer).toBeDefined())
    await writeFile(join(root, FILE), SOURCE.replace("10k", "22k"))
    answer?.()
    expect(await ended()).toMatchObject({ state: "discarded", reason: expect.stringContaining("changed while the board was placed") })
    expect(await readEntries(root)).toEqual([])
  })
})

describe("POST /api/fit-board", () => {
  test("writes the board round the parts as one human entry", async () => {
    await writeFile(join(root, FILE), SOURCE.replace(/ footprint="0603" \/>/g, ' footprint="0603" pcbX={0} pcbY={0} />').replace('footprint="soic8"', 'footprint="soic8" pcbX={-8} pcbY={0}'))
    await open()
    const fitted = await data(await api("/api/fit-board", { file: FILE, margin: 1 }))
    expect(fitted.summary).toMatch(/^Fit board: [\d.]+ × [\d.]+ mm$/)
    const entries = await readEntries(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ author: "human", summary: fitted.summary })
  })
})
