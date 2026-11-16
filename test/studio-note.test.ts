import { afterEach, beforeEach, expect, test } from "vitest"
import { createServer, type Server } from "node:http"
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runStudio, type RunningStudio } from "../src/studio/run-studio.js"
import { notePath, readNote, stopStudio, studioAnswers, writeNote } from "../src/studio/studio-note.js"

const builder = { build: async () => { throw new Error("no builds here") } }
const running: RunningStudio[] = []
const servers: Server[] = []
let requests = 0
const KEY = "a".repeat(48)

beforeEach(async () => {
  process.env["COPPERFLOW_HOME"] = await mkdtemp(join(tmpdir(), "cf-home-"))
  requests = 0
})

afterEach(async () => {
  for (const one of running.splice(0)) await one.stop()
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done))
})

async function project(): Promise<{ root: string; staticDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "cf-note-"))
  const staticDir = join(root, "static")
  await mkdir(staticDir)
  await writeFile(join(staticDir, "index.html"), "<html></html>")
  return { root, staticDir }
}

async function start(extra: Record<string, unknown> = {}): Promise<{ root: string; studio: RunningStudio }> {
  const dirs = await project()
  const studio = await runStudio({ ...dirs, builder: builder as never, routeWorker: null, placeWorker: null, port: 0, ...extra })
  running.push(studio)
  return { root: dirs.root, studio }
}

/** A plain HTTP server on a free port that answers 200 to everything. */
async function otherProgram(): Promise<number> {
  const server = createServer((_req, res) => (requests++, res.end('{"ok":true,"data":{"name":"x"}}')))
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()))
  return (server.address() as { port: number }).port
}

test("a running Studio leaves its note in the person's folder, not in the project", async () => {
  const { root, studio } = await start()
  expect(notePath(root).startsWith(join(process.env["COPPERFLOW_HOME"]!, "run"))).toBe(true)
  const note = JSON.parse(await readFile(notePath(root), "utf8"))
  expect(note).toEqual({ pid: process.pid, port: Number(new URL(studio.studio.url).port), key: studio.studio.token, root, started: expect.any(String) })
  expect(await readdir(root)).toEqual(["static"])
  if (process.platform !== "win32") expect((await stat(notePath(root))).mode & 0o077).toBe(0)
})

test("the note is gone after the Studio closes", async () => {
  const { root, studio } = await start()
  await studio.stop()
  expect(existsSync(notePath(root))).toBe(false)
})

test("an idle Studio closes and removes its note", async () => {
  const { root, studio } = await start({ idleMs: 80 })
  await studio.stopped
  expect(existsSync(notePath(root))).toBe(false)
})

test("without a port, a taken default port gives way to a free one", async () => {
  const taken = await otherProgram()
  const { studio } = await start({ port: undefined, defaultPort: taken })
  expect(Number(new URL(studio.studio.url).port)).not.toBe(taken)
})

test("a taken port given by the person is refused with a plain sentence", async () => {
  const taken = await otherProgram()
  await expect(start({ port: taken })).rejects.toThrow(`Port ${taken} is already in use. Leave out --port to use a free one.`)
})

test("studio stop with none running says so", async () => {
  const { root } = await project()
  expect(await stopStudio(root)).toBe("No Studio is running for this folder.")
})

test("studio stop asks this project's Studio to stop itself and the note goes", async () => {
  const { root, studio } = await start()
  expect(await stopStudio(root)).toBe(`Stopped the Studio at ${studio.studio.url}.`)
  await studio.stopped
  expect(existsSync(notePath(root))).toBe(false)
})

test("a stop request without the key is refused", async () => {
  const { studio } = await start()
  const answer = await fetch(`${studio.studio.url}/api/stop`, { method: "POST" })
  expect(answer.status).toBe(403)
  expect(existsSync(notePath(studio.note.root))).toBe(true)
})

test("a stale note (nothing listens) is removed and nothing is ended", async () => {
  const { root } = await project()
  await writeNote(root, { pid: 999999, port: 1, key: KEY, root, started: "x" })
  expect(await stopStudio(root)).toBe("No Studio is running for this folder.")
  expect(await readNote(root)).toBeUndefined()
})

test("a program that answers 200 to anything is stale and that program is not touched", async () => {
  const { root } = await project()
  const port = await otherProgram()
  await writeNote(root, { pid: process.pid, port, key: KEY, root, started: "x" })
  expect(await stopStudio(root)).toBe("No Studio is running for this folder.")
  expect(requests).toBe(1)
  expect(await readNote(root)).toBeUndefined()
  expect((await fetch(`http://127.0.0.1:${port}`)).status).toBe(200)
})

test("a note with a bad key, a bad port or another root is stale and nothing is requested", async () => {
  const { root } = await project()
  const port = await otherProgram()
  const bad = [
    { pid: 1, port, key: "Z".repeat(48), root, started: "x" },
    { pid: 1, port, key: `${KEY}&x`, root, started: "x" },
    { pid: 1, port: 70000, key: KEY, root, started: "x" },
    { pid: 1, port: 0, key: KEY, root, started: "x" },
    { pid: 1, port, key: KEY, root: join(root, "other"), started: "x" },
  ]
  for (const note of bad) {
    await mkdir(join(process.env["COPPERFLOW_HOME"]!, "run"), { recursive: true })
    await writeFile(notePath(root), JSON.stringify(note))
    expect(await readNote(root)).toBeUndefined()
    expect(await stopStudio(root)).toBe("No Studio is running for this folder.")
    expect(existsSync(notePath(root))).toBe(false)
  }
  expect(requests).toBe(0)
})

test("a Studio answers as this project's only with its key", async () => {
  const { root, studio } = await start()
  expect(await studioAnswers(root, studio.note)).toBe(true)
  expect(await studioAnswers(root, { ...studio.note, key: KEY })).toBe(false)
})
