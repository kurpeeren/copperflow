import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { request } from "node:http"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveCircuit } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { FOOTPRINT_FILE } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import type { DesignBuilder } from "../src/studio/live.js"
import { startStudio, type Studio } from "../src/studio/server.js"
import { createPart } from "../src/core/library.js"
import { BOARD, LDO, SHARED } from "./fixtures.js"

const FILE = "main.circuit.tsx"
/** Builds in this process, as the engine's worker does, so tests need no built worker file. */
const builder: DesignBuilder = {
  build: async (root, file) =>
    buildDesign(await collectProjectFiles(root, { include: FOOTPRINT_FILE }), (await resolveCircuit(root, file)).file),
}
let root: string
let studio: Studio

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-studio-"))
  const staticDir = join(root, "static")
  await mkdir(staticDir)
  await writeFile(join(staticDir, "index.html"), "<html><head><title>x</title></head><body>studio</body></html>")
  await writeFile(join(staticDir, "app.js"), "console.log(1)")
  await writeFile(join(root, "secret.txt"), "top secret")
  await writeFile(join(root, FILE), BOARD)
  await writeFile(join(root, "shared.ts"), SHARED)
  studio = await startStudio({ root, port: 0, staticDir, builder, maxStreams: 2 })
})

afterEach(() => studio.close())

function api(path: string, body?: unknown) {
  return fetch(`${studio.url}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-copperflow-token": studio.token, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function data(response: Response) {
  const json = (await response.json()) as { ok: boolean; data?: unknown; error?: string }
  if (!json.ok) throw new Error(`${response.status} ${json.error}`)
  return json.data as any
}

function rawGet(path: string, headers: Record<string, string>): Promise<number> {
  const { port } = new URL(studio.url)
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      res.resume()
      done(res.statusCode ?? 0)
    })
    req.on("error", fail)
    req.end()
  })
}

describe("security", () => {
  test("the page never contains the token; it travels in the URL fragment the CLI prints", async () => {
    const response = await fetch(studio.url)
    expect(await response.text()).not.toContain(studio.token)
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'")
    expect(studio.openUrl).toBe(`${studio.url}/#token=${studio.token}`)
  })

  test("static files stay inside the static folder", async () => {
    expect((await fetch(`${studio.url}/app.js`)).status).toBe(200)
    expect(await rawGet("/%2e%2e/secret.txt", {})).toBe(404)
    expect(await rawGet("/..%2fsecret.txt", {})).toBe(404)
  })

  test("API calls need the token, a local Host and no foreign Origin", async () => {
    expect((await fetch(`${studio.url}/api/circuits`)).status).toBe(403)
    const token = { "x-copperflow-token": studio.token }
    expect(await rawGet("/api/circuits", { ...token, host: "evil.example" })).toBe(403)
    expect(await rawGet("/api/circuits", { ...token, origin: "http://evil.example" })).toBe(403)
    expect(await rawGet("/api/circuits", token)).toBe(200)
  })

  test("the event stream takes the token only as a header", async () => {
    expect((await fetch(`${studio.url}/api/events?token=${studio.token}`)).status).toBe(403)
  })

  test("unexpected errors do not reveal the project path", async () => {
    const response = await api(`/api/circuit?file=${encodeURIComponent(`${FILE}\0`)}`)
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain(root)
  })

  test("a port that is already in use fails cleanly", async () => {
    const { port } = new URL(studio.url)
    await expect(startStudio({ root, port: Number(port), builder })).rejects.toThrow(/EADDRINUSE/)
  })

  test("the number of open event streams is capped", async () => {
    const controller = new AbortController()
    const open = () => fetch(`${studio.url}/api/events`, { headers: { "x-copperflow-token": studio.token }, signal: controller.signal })
    const first = await open()
    const second = await open()
    const third = await open()
    expect([first.status, second.status, third.status]).toEqual([200, 200, 429])
    controller.abort()
  })

  test("invalid bodies are rejected with a message", async () => {
    const response = await api("/api/edit", { file: FILE, edits: "nope" })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toMatch(/edits/)
  })
})

describe("editing", () => {
  test("lists circuits and describes one", async () => {
    expect(await data(await api("/api/circuits"))).toEqual([FILE])
    const circuit = await data(await api(`/api/circuit?file=${FILE}`))
    expect(circuit.model.parts.map((p: { name: string }) => p.name)).toContain("R1")
    expect(circuit.violations).toEqual([])
  })

  test("edits are written to the file as the human", async () => {
    const result = await data(await api("/api/edit", { file: FILE, summary: "move R1", edits: [{ kind: "setProps", part: "R1", props: { pcbX: 5 } }] }))
    expect(result.entryId).toBe("c0001")
    expect(await readFile(join(root, FILE), "utf8")).toContain("pcbX={5}")
    const history = await data(await api("/api/history"))
    expect(history[0]).toMatchObject({ author: "human", summary: "move R1" })
  })

  test("setTraceHints is accepted and writes the corners; malformed corners are refused", async () => {
    const hints = [{ x: 1, y: 0.5 }, { x: 1, y: 0 }]
    await data(await api("/api/edit", { file: FILE, summary: "Move GND label", edits: [{ kind: "setTraceHints", from: ".R1 > .pin1", to: "net.GND", schematicRouteHints: hints }] }))
    expect(await readFile(join(root, FILE), "utf8")).toContain('to="net.GND" schematicRouteHints={[{ x: 1, y: 0.5 }, { x: 1, y: 0 }]} />')
    const edit = (schematicRouteHints: unknown) => api("/api/edit", { file: FILE, summary: "x", edits: [{ kind: "setTraceHints", from: ".R1 > .pin1", to: "net.GND", schematicRouteHints }] })
    expect((await edit([{ x: "1", y: 0 }])).status).toBe(400)
    expect((await edit(Array.from({ length: 201 }, () => ({ x: 0, y: 0 })))).status).toBe(400)
  })

  test("locked parts cannot be edited until they are unlocked", async () => {
    await data(await api("/api/lock", { file: FILE, parts: ["R1"], locked: true }))
    const refused = await api("/api/edit", { file: FILE, summary: "x", edits: [{ kind: "setProps", part: "R1", props: { pcbX: 5 } }] })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error).toContain("R1 is locked")
    await data(await api("/api/lock", { file: FILE, parts: ["R1"], locked: false }))
    expect((await api("/api/edit", { file: FILE, summary: "x", edits: [{ kind: "setProps", part: "R1", props: { pcbX: 5 } }] })).status).toBe(200)
  })

  test("marks can be added and removed", async () => {
    const mark = await data(await api("/api/mark", { file: FILE, text: "route GND here", view: "pcb", x: 1, y: 2 }))
    expect(mark.id).toBe("m1")
    const circuit = await data(await api(`/api/circuit?file=${FILE}`))
    expect(circuit.annotations.marks[0]).toMatchObject({ text: "route GND here", x: 1, y: 2 })
    await data(await api("/api/unmark", { file: FILE, id: "m1" }))
    expect((await data(await api(`/api/circuit?file=${FILE}`))).annotations.marks).toEqual([])
  })

  test("undo restores the file", async () => {
    await data(await api("/api/edit", { file: FILE, summary: "remove LED1", edits: [{ kind: "removePart", part: "LED1" }] }))
    await data(await api("/api/undo", {}))
    expect(await readFile(join(root, FILE), "utf8")).toBe(BOARD)
  })
})

describe("parts library", () => {
  test("lists library and built-in parts and shows one part", async () => {
    await createPart(root, "LDO", LDO, { now: "t" })
    const parts = await data(await api("/api/parts"))
    expect(parts.library.map((p: { id: string }) => p.id)).toEqual(["LDO"])
    expect(parts.builtin).toContain("resistor")
    const detail = await data(await api("/api/part?id=LDO"))
    expect(detail.part.mpn).toBe("AP2112K-3.3TRG1")
    expect(detail.checklist).toContain("- [ ] Pin 1 is VIN")
  })

  test("placing picks the next free designator", async () => {
    const placed = await data(await api("/api/place", { file: FILE, part: "resistor", props: { resistance: "10k" } }))
    expect(placed.name).toBe("R2")
    expect(await readFile(join(root, FILE), "utf8")).toContain('<resistor name="R2" resistance="10k" />')
    await createPart(root, "LDO", LDO, { now: "t" })
    expect((await data(await api("/api/place", { file: FILE, part: "LDO" }))).name).toBe("U2")
  })

  test("verifying from the browser needs the part id typed back", async () => {
    await createPart(root, "LDO", LDO, { now: "t" })
    const wrong = await api("/api/verify", { id: "LDO", by: "Eren", against: "datasheet p.2", confirm: "ldo" })
    expect(wrong.status).toBe(400)
    await data(await api("/api/verify", { id: "LDO", by: "Eren", against: "datasheet p.2", confirm: "LDO" }))
    expect((await data(await api("/api/parts"))).library[0].verified).toBe(true)
  })

  test("the BOM and the package come from the open circuit", async () => {
    const lines = await data(await api(`/api/bom?file=${FILE}`))
    expect(lines.map((l: { designators: string[] }) => l.designators[0])).toContain("R1")
    const pkg = await data(await api("/api/package", { file: FILE }))
    expect(pkg.files).toContain("exports/main/BOM.csv")
  })

  test("the BOM reads the live design when it is current, and builds when it is not", async () => {
    await data(await api("/api/build", { file: FILE }))
    await buildWhen(finished)
    const build = vi.spyOn(builder, "build")
    await data(await api(`/api/bom?file=${FILE}`))
    expect(build).not.toHaveBeenCalled()
    await writeFile(join(root, FILE), BOARD.replace('"R1"', '"R7"'))
    const lines = await data(await api(`/api/bom?file=${FILE}`))
    expect(lines.map((l: { designators: string[] }) => l.designators[0])).toContain("R7")
    build.mockRestore()
  })

  test("the BOM builds when no build has run yet", async () => {
    const lines = await data(await api(`/api/bom?file=${FILE}`))
    expect(lines.length).toBeGreaterThan(0)
  })
})

/** Polls the build until `done` says it is finished, for at most `ms`. */
async function buildWhen(done: (build: any) => boolean, ms = 4000) {
  const deadline = Date.now() + ms
  let build: any
  do {
    build = await data(await api(`/api/build?file=${FILE}`))
    if (done(build)) return build
    await new Promise((r) => setTimeout(r, 20))
  } while (Date.now() < deadline)
  return build
}

const finished = (build: { status: string }) => build.status === "done" || build.status === "failed"
const ids = (build: any): string[] => build.design?.circuit.components.map((c: { id: string }) => c.id) ?? []

describe("builds and live updates", () => {
  test("a build produces the design for the viewers", async () => {
    await data(await api("/api/build", { file: FILE }))
    const build = await buildWhen(finished)
    expect(build.status).toBe("done")
    expect(ids(build)).toContain("R1")
    expect(build.design.pcb.parts.length).toBeGreaterThan(0)
    expect(build.design.diagnostics.some((d: { severity: string }) => d.severity === "error")).toBe(true)
  })

  test("a failed build keeps the last design and says where the code is wrong", async () => {
    await data(await api("/api/build", { file: FILE }))
    const first = await buildWhen(finished)
    await writeFile(join(root, FILE), "export default () => (<board")
    await data(await api("/api/build", { file: FILE }))
    const failed = await buildWhen((b) => b.status === "failed")
    expect(failed.status).toBe("failed")
    expect(failed.error).toMatch(/main\.circuit\.tsx:/)
    expect(ids(failed)).toContain("R1")
    expect(failed.finishedAt).not.toBe(first.finishedAt)
  })

  test("an edit is built at once, without waiting for the file watcher", async () => {
    await data(await api("/api/build", { file: FILE }))
    const before = await buildWhen(finished)
    const started = Date.now()
    expect(Date.parse(before.startedAt)).toBeLessThanOrEqual(started)
    await data(await api("/api/edit", { file: FILE, summary: "move R1", edits: [{ kind: "setProps", part: "R1", props: { pcbX: 5 } }] }))
    const right = await data(await api(`/api/build?file=${FILE}`))
    expect(right.status === "building" || right.finishedAt !== before.finishedAt).toBe(true)
    const after = await buildWhen((b) => finished(b) && b.finishedAt !== before.finishedAt, 2000)
    expect(Date.now() - started).toBeLessThan(2000)
    // The browser keeps a moved part's preview until a build that started after its edit was sent.
    expect(Date.parse(after.startedAt)).toBeGreaterThanOrEqual(started)
    expect(after.design.pcb.parts.find((p: { component: string }) => p.component === "R1").x).toBe(5)
  })

  test("one edit request can carry 120 changes", async () => {
    const edits = Array.from({ length: 120 }, (_, i) => ({ kind: "setProps", part: "R1", props: { pcbX: i } }))
    const response = await api("/api/edit", { file: FILE, summary: "Keep auto-placed positions", edits })
    expect(response.status).toBe(200)
    expect(await readFile(join(root, FILE), "utf8")).toContain("pcbX={119}")
  })

  test("a change to a circuit file is announced over server-sent events", async () => {
    const controller = new AbortController()
    const response = await fetch(`${studio.url}/api/events`, {
      headers: { "x-copperflow-token": studio.token },
      signal: controller.signal,
    })
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    const reader = response.body!.getReader()
    await new Promise((r) => setTimeout(r, 200))
    await writeFile(join(root, FILE), BOARD.replace("pcbX={-4}", "pcbX={-3}"))
    let text = ""
    const deadline = Date.now() + 5000
    while (!text.includes("event: change") && Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      text += new TextDecoder().decode(value)
    }
    controller.abort()
    expect(text).toContain("event: change")
    expect(text).toContain(`"file":"${FILE}"`)
  })
})
