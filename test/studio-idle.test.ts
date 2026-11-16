import { afterEach, expect, test, vi } from "vitest"
import { request } from "node:http"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Studio } from "../src/studio/server.js"
import { startReachableStudio } from "./helpers/reachable-studio.js"

const builder = { build: async () => { throw new Error("no builds here") } }
let studio: Studio | undefined

afterEach(async () => {
  await studio?.close()
  studio = undefined
})

async function project(): Promise<{ root: string; staticDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "cf-idle-"))
  const staticDir = join(root, "static")
  await mkdir(staticDir)
  await writeFile(join(staticDir, "index.html"), "<html></html>")
  return { root, staticDir }
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

test("a Studio with no tab connected for the idle period calls onIdle", async () => {
  const onIdle = vi.fn()
  studio = await startReachableStudio({ ...(await project()), builder: builder as never, routeWorker: null, placeWorker: null, idleMs: 80, onIdle })
  await vi.waitFor(() => expect(onIdle).toHaveBeenCalledTimes(1), { timeout: 2000 })
})

test("an open event stream keeps the Studio awake; closing it starts the idle period", async () => {
  const onIdle = vi.fn()
  studio = await startReachableStudio({ ...(await project()), builder: builder as never, routeWorker: null, placeWorker: null, idleMs: 150, onIdle })
  const { port } = new URL(studio.url)
  const stream = request({ host: "127.0.0.1", port, path: "/api/events", headers: { "x-copperflow-token": studio.token } })
  const opened = new Promise<void>((done) => stream.on("response", () => done()))
  stream.on("error", () => {})
  stream.end()
  await opened
  await wait(400)
  expect(onIdle).not.toHaveBeenCalled()
  stream.destroy()
  await vi.waitFor(() => expect(onIdle).toHaveBeenCalledTimes(1), { timeout: 2000 })
})

test("without idleMs the Studio never stops by itself", async () => {
  const onIdle = vi.fn()
  studio = await startReachableStudio({ ...(await project()), builder: builder as never, routeWorker: null, placeWorker: null, onIdle })
  await wait(200)
  expect(onIdle).not.toHaveBeenCalled()
})
