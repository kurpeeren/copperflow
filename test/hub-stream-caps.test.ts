import { afterEach, expect, test } from "vitest"
import { createServer, request, type ClientRequest, type Server } from "node:http"
import { MAX_STREAMS_PER_USER } from "../src/hub/project-origin.js"
import { MAX_RESPONSE_BYTES } from "../src/hub/proxy.js"
import type { HubServer } from "../src/hub/server.js"
import { fixedRunner, newUser, projectOriginOf, startTestHub } from "./helpers/hub-client.js"

let server: HubServer | undefined
let upstream: Server | undefined
const open: ClientRequest[] = []
afterEach(async () => {
  for (const req of open.splice(0)) req.destroy()
  await server?.close()
  server = undefined
  upstream?.closeAllConnections()
  await new Promise<void>((done) => (upstream ? upstream.close(() => done()) : done()))
  upstream = undefined
})

/** A stand-in Studio: /api/events is a real stream; every other path answers an endless body labelled as an event stream. */
async function fakeStudio(): Promise<string> {
  upstream = createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" })
    if (req.url === "/api/events") {
      res.write(": connected\n\n")
      const timer = setInterval(() => res.write(": ping\n\n"), 20)
      res.on("close", () => clearInterval(timer))
      return
    }
    const chunk = Buffer.alloc(1024 * 1024, 120)
    const pump = () => {
      while (!res.destroyed && res.write(chunk)) continue
      if (!res.destroyed) res.once("drain", pump)
    }
    pump()
  })
  await new Promise<void>((done) => upstream?.listen(0, "127.0.0.1", () => done()))
  const address = upstream.address()
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`
}

function get(hubUrl: string, id: string, cookie: string, path: string): Promise<{ status: number; bytes: Promise<number> }> {
  const url = new URL(hubUrl)
  return new Promise((done, fail) => {
    const req = request({ agent: false, host: url.hostname, port: url.port, path, headers: { host: new URL(projectOriginOf(id)).host, cookie } }, (res) => {
      let total = 0
      const bytes = new Promise<number>((over) => {
        res.on("data", (chunk: Buffer) => (total += chunk.length))
        res.on("close", () => over(total))
        res.on("error", () => over(total))
      })
      done({ status: res.statusCode ?? 0, bytes })
    })
    open.push(req)
    req.on("error", (error) => (/socket hang up|aborted|ECONNRESET/.test(error.message) ? undefined : fail(error)))
    req.end()
  })
}

test("an endless answer labelled as an event stream on any other path keeps the size cap; /api/events is the stream", async () => {
  const studio = await fakeStudio()
  server = await startTestHub({ runner: () => fixedRunner(() => studio) })
  const ada = await newUser(server, "ada@example.com")
  await ada.submit("/projects", "/projects", { name: "Amp" })
  const id = server.hub.store.projects(server.hub.store.userByEmail("ada@example.com")?.id as string)[0]?.id as string
  await ada.openProject(id)
  const capped = await get(server.url, id, ada.cookie(), "/api/circuits")
  expect(capped.status).toBe(200)
  const total = await capped.bytes
  expect(total).toBeGreaterThan(0)
  expect(total).toBeLessThanOrEqual(MAX_RESPONSE_BYTES + 2 * 1024 * 1024)
  // The real stream is still open after a moment.
  const events = await get(server.url, id, ada.cookie(), "/api/events")
  expect(events.status).toBe(200)
  let ended = false
  void events.bytes.then(() => (ended = true))
  await new Promise((r) => setTimeout(r, 200))
  expect(ended).toBe(false)
}, 60_000)

test("a user holds at most 8 event streams; a ninth is a 429, and closing one frees a place; another user is unaffected", async () => {
  const studio = await fakeStudio()
  server = await startTestHub({ runner: () => fixedRunner(() => studio) })
  const ada = await newUser(server, "ada@example.com")
  const bob = await newUser(server, "bob@example.com")
  await ada.submit("/projects", "/projects", { name: "Amp" })
  await bob.submit("/projects", "/projects", { name: "Amp" })
  const idOf = (email: string) => server?.hub.store.projects(server.hub.store.userByEmail(email)?.id as string)[0]?.id as string
  await ada.openProject(idOf("ada@example.com"))
  await bob.openProject(idOf("bob@example.com"))
  expect(MAX_STREAMS_PER_USER).toBe(8)
  for (let i = 0; i < MAX_STREAMS_PER_USER; i += 1) expect((await get(server.url, idOf("ada@example.com"), ada.cookie(), "/api/events")).status).toBe(200)
  const ninth = await get(server.url, idOf("ada@example.com"), ada.cookie(), "/api/events")
  expect(ninth.status).toBe(429)
  expect((await get(server.url, idOf("bob@example.com"), bob.cookie(), "/api/events")).status).toBe(200)
  open[0]?.destroy()
  await new Promise((r) => setTimeout(r, 200))
  expect((await get(server.url, idOf("ada@example.com"), ada.cookie(), "/api/events")).status).toBe(200)
  expect(server.hub.streamsOpen.get(server.hub.store.userByEmail("ada@example.com")?.id as string)).toBe(MAX_STREAMS_PER_USER)
}, 60_000)
