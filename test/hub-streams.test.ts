import { afterEach, describe, expect, test } from "vitest"
import { request, type ClientRequest } from "node:http"
import { readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { PassThrough, Writable } from "node:stream"
import { installSafetyNet } from "../src/hub/commands.js"
import { paced } from "../src/hub/project-routes.js"
import type { HubServer } from "../src/hub/server.js"
import { formToken, newUser, ORIGIN, startTestHub, type Browser } from "./helpers/hub-client.js"

let server: HubServer | undefined
const open: ClientRequest[] = []
afterEach(async () => {
  for (const req of open.splice(0)) req.destroy()
  await server?.close()
  server = undefined
})

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** Bytes that do not compress, so the download really streams. */
const noise = (size: number) => Buffer.from(Array.from({ length: size }, (_, i) => (i * 7919 + (i >> 8) * 104729) % 251))

async function project(hub: HubServer, ada: Browser): Promise<{ id: string; dir: string }> {
  await ada.submit("/projects", "/projects", { name: "Amp" })
  const userId = hub.hub.store.userByEmail("ada@example.com")?.id as string
  const id = hub.hub.store.projects(userId)[0]?.id as string
  return { id, dir: hub.hub.files.projectDir(userId, id) }
}

/** Starts a download and hands back the request, its response once it begins, and how it ended. */
function startDownload(hub: HubServer, ada: Browser, id: string): { req: ClientRequest; first: Promise<void>; ended: Promise<"complete" | "broken"> } {
  const url = new URL(hub.url)
  let firstData!: () => void
  const first = new Promise<void>((done) => (firstData = done))
  let settle!: (how: "complete" | "broken") => void
  const ended = new Promise<"complete" | "broken">((done) => (settle = done))
  const req = request({ agent: false, host: url.hostname, port: url.port, path: `/projects/${id}/download`, headers: { host: new URL(ORIGIN).host, cookie: ada.cookie() } }, (res) => {
    res.on("data", () => firstData())
    res.on("end", () => settle("complete"))
    res.on("error", () => settle("broken"))
    res.on("aborted", () => settle("broken"))
    res.on("close", () => settle(res.complete ? "complete" : "broken"))
    res.pause()
    setTimeout(() => res.resume(), 100)
  })
  req.on("error", () => settle("broken"))
  req.end()
  open.push(req)
  return { req, first, ended }
}

describe("streams in the hub", () => {
  test("a file removed while its project downloads ends that download, and the hub answers the next request", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const { id, dir } = await project(server, ada)
    await writeFile(join(dir, "a.bin"), noise(4 * 1024 * 1024))
    await writeFile(join(dir, "b.bin"), noise(1024))
    const download = startDownload(server, ada, id)
    await wait(30)
    await rm(join(dir, "b.bin"))
    expect(await download.ended).toBe("broken")
    expect((await ada.get("/projects")).status).toBe(200)
    expect(server.hub.transfers.downloads.size).toBe(0)
  })

  test("a client that goes away mid-download frees its slot and leaves no listener behind", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const { id, dir } = await project(server, ada)
    await writeFile(join(dir, "a.bin"), noise(8 * 1024 * 1024))
    const download = startDownload(server, ada, id)
    await download.first
    download.req.destroy()
    for (let i = 0; i < 50 && server.hub.transfers.downloads.size > 0; i += 1) await wait(20)
    expect(server.hub.transfers.downloads.size).toBe(0)
    expect((await ada.get(`/projects/${id}/download`)).status).toBe(200)
  })

  test("five parallel uploads by one user take one hub-wide slot; the rest get 429 at once", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const token = formToken((await ada.get("/projects")).text)
    const boundary = "b0undary"
    const url = new URL(server.url)
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="form"\r\n\r\n${token}\r\n--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="p.zip"\r\n\r\n`
    const answers: Promise<number>[] = []
    for (let i = 0; i < 5; i += 1) {
      answers.push(
        new Promise((done) => {
          const req = request(
            { agent: false, host: url.hostname, port: url.port, method: "POST", path: "/projects/upload", headers: { host: new URL(ORIGIN).host, origin: ORIGIN, cookie: ada.cookie(), "content-type": `multipart/form-data; boundary=${boundary}`, "transfer-encoding": "chunked" } },
            (res) => {
              res.resume()
              done(res.statusCode ?? 0)
            },
          )
          req.on("error", () => done(-1))
          req.write(head)
          open.push(req)
        }),
      )
      await wait(30)
    }
    const settled = await Promise.race([Promise.all(answers.slice(1)), wait(2000).then(() => [])])
    expect(settled).toEqual([429, 429, 429, 429])
    expect(server.hub.transfers.uploads).toBe(1)
  })

  test("an ordinary request that trickles its body is cut at the request timeout", async () => {
    server = await startTestHub({ requestTimeoutMs: 300 })
    const url = new URL(server.url)
    const closed = await new Promise<number>((done) => {
      const started = Date.now()
      const req = request({ agent: false, host: url.hostname, port: url.port, method: "POST", path: "/signin", headers: { host: new URL(ORIGIN).host, origin: ORIGIN, "content-type": "application/x-www-form-urlencoded", "content-length": "1000" } })
      req.on("error", () => done(Date.now() - started))
      req.on("response", (res) => {
        res.resume()
        res.on("close", () => done(Date.now() - started))
      })
      req.write("a")
      const drip = setInterval(() => req.write("b"), 100)
      req.on("close", () => clearInterval(drip))
      open.push(req)
    })
    expect(closed).toBeLessThan(3000)
  })

  test("an early 403 on a POST whose body was not read closes the socket", async () => {
    server = await startTestHub()
    const url = new URL(server.url)
    const answer = await new Promise<{ status: number; connection: string | undefined; socketClosed: Promise<void> }>((done, fail) => {
      const req = request({ agent: false, host: url.hostname, port: url.port, method: "POST", path: "/projects", headers: { host: new URL(ORIGIN).host, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded", "content-length": "100000" } }, (res) => {
        res.resume()
        const socketClosed = new Promise<void>((over) => req.socket?.once("close", () => over()))
        done({ status: res.statusCode ?? 0, connection: res.headers.connection, socketClosed })
      })
      req.on("error", () => undefined)
      req.write("x")
      open.push(req)
      setTimeout(() => fail(new Error("no answer")), 5000)
    })
    expect(answer.status).toBe(403)
    expect(answer.connection).toBe("close")
    await answer.socketClosed
  })

  test("a disk that fails during an upload gets 507, the hub keeps serving and nothing is left behind", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    for (const code of ["ENOSPC", "EACCES"]) {
      server.hub.files.uploadSink = () =>
        new Writable({
          write: (_chunk, _encoding, next) => next(Object.assign(new Error("disk"), { code })),
        })
      const answer = await ada.upload(`up ${code}`, Buffer.alloc(200_000, 1))
      expect(answer.status).toBe(code === "ENOSPC" ? 507 : 500)
      expect(answer.text).toContain(code === "ENOSPC" ? "no room for this upload" : "could not be stored")
    }
    expect((await ada.get("/projects")).status).toBe(200)
    expect(await readdir(server.hub.files.uploads)).toEqual([])
    expect(server.hub.store.projects(server.hub.store.userByEmail("ada@example.com")?.id as string)).toEqual([])
  })

  test("an upload that stalls or crawls is stopped", async () => {
    const source = new PassThrough()
    const req = Object.assign(source, { setTimeout: (ms: number, then: () => void) => setTimeout(then, ms).unref() }) as unknown as Parameters<typeof paced>[0]
    const reading = (async () => {
      for await (const chunk of paced(req, { idleMs: 10_000, minBytesPerS: 1000, rateAfterMs: 50, checkMs: 10 }).body) void chunk
    })()
    source.write(Buffer.alloc(5))
    await expect(reading).rejects.toThrow("The upload was too slow and was stopped.")
  })

  test("the safety net records an unhandled rejection and keeps serving; an uncaught exception stops cleanly", async () => {
    server = await startTestHub()
    const handlers = new Map<string, (error: unknown) => void>()
    let stopped = false
    installSafetyNet(server.hub.store, () => (stopped = true), { on: (event: string, handler: (error: unknown) => void) => handlers.set(event, handler) } as unknown as Pick<NodeJS.Process, "on">)
    handlers.get("unhandledRejection")?.(Object.assign(new Error("secret value 123"), { code: "ENOENT" }))
    expect(stopped).toBe(false)
    handlers.get("uncaughtException")?.(new TypeError("another secret"))
    expect(stopped).toBe(true)
    const log = server.hub.store.auditLog(2)
    expect(log.map((e) => [e.event, e.detail])).toEqual([["hub-uncaught-exception", "TypeError"], ["hub-unhandled-rejection", "Error ENOENT"]])
    expect(JSON.stringify(log)).not.toContain("secret")
  })
})
