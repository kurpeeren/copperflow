import { afterEach, expect, test, vi } from "vitest"
import { createServer, type Server } from "node:http"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runStudio, type RunningStudio } from "../src/studio/run-studio.js"
import { notePath, readNote, stopStudio, writeNote } from "../src/studio/studio-note.js"

const builder = { build: async () => { throw new Error("no builds here") } }
const running: RunningStudio[] = []
const servers: Server[] = []

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
  const server = createServer((_req, res) => res.end('{"ok":true,"data":{"name":"x"}}'))
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()))
  return (server.address() as { port: number }).port
}

test("a running Studio leaves its note, and a .gitignore that ignores it", async () => {
  const { root, studio } = await start()
  const note = JSON.parse(await readFile(notePath(root), "utf8"))
  expect(note).toEqual({ pid: process.pid, port: Number(new URL(studio.studio.url).port), url: studio.studio.url, openUrl: studio.studio.openUrl, started: expect.any(String) })
  expect(await readFile(join(root, ".copperflow", ".gitignore"), "utf8")).toBe("studio.json\n")
  if (process.platform !== "win32") expect((await stat(notePath(root))).mode & 0o077).toBe(0)
})

test("an existing .copperflow/.gitignore is left as it is", async () => {
  const dirs = await project()
  await mkdir(join(dirs.root, ".copperflow"))
  await writeFile(join(dirs.root, ".copperflow", ".gitignore"), "history/\n")
  running.push(await runStudio({ ...dirs, builder: builder as never, routeWorker: null, placeWorker: null, port: 0 }))
  expect(await readFile(join(dirs.root, ".copperflow", ".gitignore"), "utf8")).toBe("history/\n")
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

test("studio stop ends this project's Studio and removes the note", async () => {
  const { root, studio } = await start()
  const kill = vi.fn(() => void studio.stop())
  expect(await stopStudio(root, kill)).toBe(`Stopped the Studio at ${studio.studio.url}.`)
  expect(kill).toHaveBeenCalledWith(process.pid)
  expect(existsSync(notePath(root))).toBe(false)
})

test("a stale note (nothing listens) is removed and nothing is ended", async () => {
  const { root } = await project()
  await writeNote(root, { pid: 999999, port: 1, url: "http://127.0.0.1:1", openUrl: "http://127.0.0.1:1/#token=ab", started: "x" })
  const kill = vi.fn()
  expect(await stopStudio(root, kill)).toBe("No Studio is running for this folder.")
  expect(kill).not.toHaveBeenCalled()
  expect(await readNote(root)).toBeUndefined()
})

test("a note naming another program's port is stale and that program is not touched", async () => {
  const { root } = await project()
  const port = await otherProgram()
  const url = `http://127.0.0.1:${port}`
  await writeNote(root, { pid: process.pid, port, url, openUrl: `${url}/#token=ab`, started: "x" })
  const kill = vi.fn()
  expect(await stopStudio(root, kill)).toBe("No Studio is running for this folder.")
  expect(kill).not.toHaveBeenCalled()
  expect((await fetch(url)).status).toBe(200)
})
