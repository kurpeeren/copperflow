import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { request } from "node:http"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { startStudio, type Studio } from "../src/studio/server.js"
import { BOARD } from "./fixtures.js"

const FAKE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-tsci.mjs", import.meta.url))]
const FILE = "main.circuit.tsx"
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
  await writeFile(join(root, "main.circuit.fake.json"), JSON.stringify({ elements: [{ type: "pcb_board" }] }))
  studio = await startStudio({ root, port: 0, staticDir, buildCommand: FAKE, maxStreams: 2 })
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
    await expect(startStudio({ root, port: Number(port), buildCommand: FAKE })).rejects.toThrow(/EADDRINUSE/)
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

describe("builds and live updates", () => {
  test("a build produces circuit JSON for the viewers", async () => {
    await data(await api("/api/build", { file: FILE }))
    let build: any
    for (let i = 0; i < 50; i++) {
      build = await data(await api(`/api/build?file=${FILE}`))
      if (build.status === "done" || build.status === "failed") break
      await new Promise((r) => setTimeout(r, 100))
    }
    expect(build.status).toBe("done")
    expect(build.circuitJson).toEqual([{ type: "pcb_board" }])
    expect(build.report.ok).toBe(true)
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
