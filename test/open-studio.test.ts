import { afterEach, beforeEach, expect, test, vi } from "vitest"
import { createServer, get, type Server } from "node:http"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { cliStarter, openStudio, studioArgs, type StudioStarter } from "../src/mcp/open-studio.js"
import { runStudio, type RunningStudio } from "../src/studio/run-studio.js"
import { notePath, projectRoot, readNote, stopStudio, studioOpenUrl, studioUrl, writeNote } from "../src/studio/studio-note.js"

const builder = { build: async () => { throw new Error("no builds here") } }
const running: RunningStudio[] = []
const servers: Server[] = []

beforeEach(async () => {
  process.env["COPPERFLOW_HOME"] = await mkdtemp(join(tmpdir(), "cf-home-"))
})

afterEach(async () => {
  for (const one of running.splice(0)) await one.stop()
  for (const server of servers.splice(0)) await new Promise((done) => server.close(done))
})

async function project(): Promise<{ root: string; staticDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "cf-open-"))
  const staticDir = join(root, "static")
  await mkdir(staticDir)
  await writeFile(join(staticDir, "index.html"), "<html></html>")
  return { root, staticDir }
}

/** A starter that runs the Studio in this process, as the CLI child would. */
function inProcess(staticDir: string): StudioStarter & { calls: number } {
  const starter = Object.assign(
    (root: string) => {
      starter.calls++
      const started = runStudio({ root, staticDir, builder: builder as never, routeWorker: null, placeWorker: null, port: 0, idleMinutes: 60 })
      started.then((studio) => running.push(studio), () => {})
      return { exited: new Promise<number | null>(() => {}) }
    },
    { calls: 0 },
  )
  return starter
}

const SESSION_LINE = "The address holds this session's key: give it to the person only."
const IDLE_SENTENCE = "It stops by itself 60 minutes after the last tab closes."

test("starts a Studio, opens the browser and answers in the agreed shape", async () => {
  const { root, staticDir } = await project()
  const opened: string[] = []
  const text = await openStudio({ root, start: inProcess(staticDir), openBrowser: async (url) => (opened.push(url), true) }, {})
  const note = (await readNote(root))!
  expect(text).toBe(`The Studio is running at ${studioUrl(note)} (started now). Opened it in the browser.\n${studioOpenUrl(note)}\n${SESSION_LINE} ${IDLE_SENTENCE}`)
  expect(opened).toEqual([studioOpenUrl(note)])
})

test("a browser that cannot be opened is not a failure", async () => {
  const { root, staticDir } = await project()
  const text = await openStudio({ root, start: inProcess(staticDir), openBrowser: async () => false }, {})
  expect(text).toContain("(started now). Could not open a browser here: give the person this address.\n")
})

test("open: false does not touch the browser", async () => {
  const { root, staticDir } = await project()
  const openBrowser = vi.fn(async () => true)
  const text = await openStudio({ root, start: inProcess(staticDir), openBrowser }, { open: false })
  expect(openBrowser).not.toHaveBeenCalled()
  expect(text.split("\n")[0]).toMatch(/^The Studio is running at http:\/\/127\.0\.0\.1:\d+ \(started now\)\.$/)
})

test("two calls give the same address and start one process", async () => {
  const { root, staticDir } = await project()
  const start = inProcess(staticDir)
  const ports = { root, start, openBrowser: async () => true }
  const [first, second] = await Promise.all([openStudio(ports, { open: false }), openStudio(ports, { open: false })])
  const third = await openStudio(ports, { open: false })
  expect(start.calls).toBe(1)
  const address = (text: string) => text.split("\n")[1]
  expect(address(second)).toBe(address(first))
  expect(address(third)).toBe(address(first))
  expect(third.split("\n")[0]).toMatch(/\(already running\)\.$/)
})

test("a Studio started by hand is reused without the idle sentence", async () => {
  const dirs = await project()
  running.push(await runStudio({ ...dirs, builder: builder as never, routeWorker: null, placeWorker: null, port: 0 }))
  const start = inProcess(dirs.staticDir)
  const text = await openStudio({ root: dirs.root, start, openBrowser: async () => true }, {})
  expect(start.calls).toBe(0)
  expect(text).toMatch(/\(already running\)\. Opened it in the browser\.\n/)
  expect(text.endsWith(SESSION_LINE)).toBe(true)
})

test("a stale note is replaced by a new Studio", async () => {
  const { root, staticDir } = await project()
  await writeNote(root, { pid: 999999, port: 1, key: "a".repeat(48), root: projectRoot(root), started: "x" })
  const start = inProcess(staticDir)
  const text = await openStudio({ root, start, openBrowser: async () => true }, { open: false })
  expect(start.calls).toBe(1)
  expect(text).toContain("(started now)")
  expect((await readNote(root))?.port).not.toBe(1)
})

test("a Studio process that ends before it is ready is reported", async () => {
  const { root } = await project()
  const start = () => ({ exited: Promise.resolve(1) })
  await expect(openStudio({ root, start, openBrowser: async () => true }, {})).rejects.toThrow(
    "The Studio did not start: its process ended (exit code 1).",
  )
})

test("a Studio that never leaves its note is reported after the wait", async () => {
  const { root } = await project()
  const start = () => ({ exited: new Promise<number | null>(() => {}) })
  await expect(openStudio({ root, start, openBrowser: async () => true, waitMs: 300 }, {})).rejects.toThrow(
    "The Studio did not start within 0.3 s.",
  )
})

test("the CLI child is started with the idle stop of 60 minutes", () => {
  expect(studioArgs("/x/cli.js", "/p")).toEqual(["/x/cli.js", "studio", "--root", "/p", "--idle-minutes", "60"])
})

test("a planted note with another address, host or key opens nothing and requests nothing", async () => {
  const { root } = await project()
  let requests = 0
  const server = createServer((_req, res) => (requests++, res.end('{"ok":true,"data":{}}')))
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", () => done()))
  const port = (server.address() as { port: number }).port
  const planted = [
    { pid: 1, port, key: "a".repeat(48), root: "/elsewhere", started: "x", url: "file:///etc/passwd", openUrl: "file:///etc/passwd" },
    { pid: 1, port: "evil.example:80", key: "a".repeat(48), root: projectRoot(root), started: "x" },
    { pid: 1, port, key: "a".repeat(47) + "#", root: projectRoot(root), started: "x" },
  ]
  for (const note of planted) {
    await mkdir(join(process.env["COPPERFLOW_HOME"]!, "run"), { recursive: true })
    await writeFile(notePath(root), JSON.stringify(note))
    const openBrowser = vi.fn(async () => true)
    const start = () => ({ exited: Promise.resolve(1) })
    await expect(openStudio({ root, start, openBrowser }, {})).rejects.toThrow("The Studio did not start")
    expect(openBrowser).not.toHaveBeenCalled()
  }
  expect(requests).toBe(0)
})

const CLI = resolve("dist/cli.js")

test.skipIf(!existsSync(CLI))("a real round trip: start the built CLI, reuse it, GET it, stop it", { timeout: 30_000 }, async () => {
  const { root } = await project()
  let pid: number | undefined
  try {
    const start: StudioStarter = (dir) => {
      const child = cliStarter(CLI)(dir)
      pid = child.pid
      return child
    }
    // Shorter than the test's own limit: a build that never writes its note (an old dist) fails here, and the
    // child is ended below instead of being left behind when the test times out.
    const ports = { root, start, openBrowser: async () => false, waitMs: 20_000 }
    const first = await openStudio(ports, { open: false })
    expect((await readNote(root))?.pid).toBe(pid)
    const second = await openStudio(ports, { open: false })
    expect(second.split("\n")[1]).toBe(first.split("\n")[1])
    expect(second).toContain("(already running)")
    const note = (await readNote(root))!
    const status = await new Promise<number | undefined>((done, fail) => get(studioUrl(note), (res) => (res.resume(), done(res.statusCode))).on("error", fail))
    expect(status).toBe(200)
    expect(await stopStudio(root)).toBe(`Stopped the Studio at ${studioUrl(note)}.`)
    expect(existsSync(notePath(root))).toBe(false)
  } finally {
    if (pid !== undefined) {
      try {
        process.kill(pid)
      } catch {
        // already ended
      }
    }
  }
})
