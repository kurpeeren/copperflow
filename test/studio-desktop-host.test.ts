import { afterEach, beforeEach, expect, test } from "vitest"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openStudio } from "../src/mcp/open-studio.js"
import { runStudio, type RunningStudio } from "../src/studio/run-studio.js"
import { focusStudio, postActivity, readNote, studioAnswers, studioOpenUrl, writeNote, type StudioNote } from "../src/studio/studio-note.js"

const builder = { build: async () => { throw new Error("no builds here") } }
const running: RunningStudio[] = []

beforeEach(async () => {
  process.env["COPPERFLOW_HOME"] = await mkdtemp(join(tmpdir(), "cf-home-"))
})

afterEach(async () => {
  for (const one of running.splice(0)) await one.stop()
})

async function start(extra: Record<string, unknown> = {}): Promise<{ root: string; studio: RunningStudio }> {
  const root = await mkdtemp(join(tmpdir(), "cf-host-"))
  const staticDir = join(root, "static")
  await mkdir(staticDir)
  await writeFile(join(staticDir, "index.html"), "<html></html>")
  const studio = await runStudio({ root, staticDir, builder: builder as never, routeWorker: null, placeWorker: null, port: 0, ...extra })
  running.push(studio)
  return { root, studio }
}

/** The first `activity` event the Studio's event stream sends, once `send` has run. */
async function firstActivity(studio: RunningStudio, send: () => Promise<unknown>): Promise<unknown> {
  const controller = new AbortController()
  const response = await fetch(`${studio.studio.url}/api/events`, { headers: { "x-copperflow-token": studio.note.key }, signal: controller.signal })
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  await send()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) throw new Error("the stream ended")
    buffer += value
    const found = /event: activity\ndata: (.+)\n\n/.exec(buffer)
    if (found) {
      controller.abort()
      return JSON.parse(found[1]!)
    }
  }
}

test("a Studio the desktop app hosts says so in its note and its answer; one without host keeps the old note", async () => {
  const hosted = await start({ host: "desktop", onFocus: () => undefined })
  expect((await readNote(hosted.root))?.host).toBe("desktop")
  const answer = (await (await fetch(`${hosted.studio.studio.url}/api/studio`, { headers: { "x-copperflow-token": hosted.studio.note.key } })).json()) as { data: { host?: string } }
  expect(answer.data.host).toBe("desktop")
  expect(await studioAnswers(hosted.root, hosted.studio.note)).toBe(true)
  const plain = await start()
  expect(await readNote(plain.root)).not.toHaveProperty("host")
  expect(await studioAnswers(plain.root, plain.studio.note)).toBe(true)
})

test("POST /api/focus calls onFocus and answers focused; without onFocus it is not a route", async () => {
  let focused = 0
  const hosted = await start({ host: "desktop", onFocus: () => focused++ })
  expect(await focusStudio(hosted.studio.note)).toBe(true)
  expect(focused).toBe(1)
  const plain = await start()
  const response = await fetch(`${plain.studio.studio.url}/api/focus`, { method: "POST", headers: { "x-copperflow-token": plain.studio.note.key } })
  expect(response.status).toBe(404)
  expect(await focusStudio(plain.studio.note)).toBe(false)
})

test("POST /api/focus needs the key", async () => {
  let focused = 0
  const hosted = await start({ host: "desktop", onFocus: () => focused++ })
  const response = await fetch(`${hosted.studio.studio.url}/api/focus`, { method: "POST" })
  expect(response.status).toBe(403)
  expect(focused).toBe(0)
})

test("an activity posted with the key reaches every viewer as an activity event", async () => {
  const { studio } = await start()
  const activity = { tool: "autoroute", message: "Routing: 3 of 8 connections, pass 2", progress: 3, total: 8, state: "running" as const }
  expect(await firstActivity(studio, () => postActivity(studio.note, activity, 1000))).toEqual(activity)
})

test("an activity that is not one is refused", async () => {
  const { studio } = await start()
  const bad = await fetch(`${studio.studio.url}/api/activity`, { method: "POST", headers: { "x-copperflow-token": studio.note.key, "content-type": "application/json" }, body: JSON.stringify({ tool: "x", message: "m", state: "asleep" }) })
  expect(bad.status).toBe(400)
  const noKey = await fetch(`${studio.studio.url}/api/activity`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "x", message: "m", state: "done" }) })
  expect(noKey.status).toBe(403)
})

test("open_studio brings the desktop app's window to the front instead of opening a browser, and still gives the address", async () => {
  let focused = 0
  const { root, studio } = await start({ host: "desktop", onFocus: () => focused++ })
  const opened: string[] = []
  const text = await openStudio({ root, openBrowser: async (url) => (opened.push(url), true) }, {})
  expect(focused).toBe(1)
  expect(opened).toEqual([])
  const lines = text.split("\n")
  expect(lines[0]).toBe("copperflow is open on this project in the desktop app; it was brought to the front. A browser can open the same Studio at this address:")
  expect(lines[1]).toBe(studioOpenUrl(studio.note))
})

test("open_studio opens the browser when the desktop window cannot be brought forward", async () => {
  const { root } = await start({ host: "desktop", onFocus: () => undefined })
  const opened: string[] = []
  const text = await openStudio({ root, focus: async () => false, openBrowser: async (url) => (opened.push(url), true) }, {})
  expect(opened).toHaveLength(1)
  expect(text.split("\n")[0]).toMatch(/already running\)\. Opened it in the browser\.$/)
})

test("open: false leaves the desktop window where it is", async () => {
  let focused = 0
  const { root } = await start({ host: "desktop", onFocus: () => focused++ })
  const text = await openStudio({ root }, { open: false })
  expect(focused).toBe(0)
  expect(text.split("\n")[0]).toBe("copperflow is open on this project in the desktop app. A browser can open the same Studio at this address:")
})

test("a note without host and one with an unknown host: the first reads, the second is refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-host-note-"))
  const note: StudioNote = { pid: 7, port: 4777, key: "b".repeat(48), root: (await import("../src/studio/studio-note.js")).projectRoot(root), started: "2026-11-19T00:00:00.000Z" }
  await writeNote(root, note)
  expect(await readNote(root)).toEqual(note)
  await writeNote(root, { ...note, host: "phone" as never })
  expect(await readNote(root)).toBeUndefined()
})
