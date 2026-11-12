import { afterEach, describe, expect, test } from "vitest"
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { ticketPublicKey, verifyTicket, TICKET_HEADER } from "../src/hosted/ticket.js"
import { createProcessRunner } from "../src/hub/runner/process-runner.js"
import type { HubServer } from "../src/hub/server.js"
import { BOARD } from "./fixtures.js"
import { fixedRunner, newUser, ORIGIN, startTestHub, type Browser } from "./helpers/hub-client.js"
import { workspaceCli } from "./helpers/workspace-cli.js"

let server: HubServer | undefined
let upstream: Server | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
  upstream?.closeAllConnections()
  await new Promise<void>((done) => (upstream ? upstream.close(() => done()) : done()))
  upstream = undefined
})

async function projectOf(hub: HubServer, browser: Browser, email: string): Promise<string> {
  await browser.submit("/projects", "/projects", { name: "Amp" })
  return hub.hub.store.projects(hub.hub.store.userByEmail(email)?.id as string)[0]?.id as string
}

/** A stand-in Studio that records what reaches it; /events streams until the client goes away. */
async function recorder(): Promise<{ origin: string; seen: { method: string; url: string; headers: IncomingHttpHeaders; body: string }[]; streamClosed: Promise<void> }> {
  const seen: { method: string; url: string; headers: IncomingHttpHeaders; body: string }[] = []
  let closed!: () => void
  const streamClosed = new Promise<void>((done) => (closed = done))
  upstream = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk: Buffer) => (body += chunk.toString()))
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body })
      if (req.url?.endsWith("/api/events")) {
        res.writeHead(200, { "content-type": "text/event-stream", "set-cookie": "evil=1" })
        res.write("event: hello\ndata: 1\n\n")
        const timer = setInterval(() => res.write("event: tick\ndata: 2\n\n"), 20)
        res.on("close", () => {
          clearInterval(timer)
          closed()
        })
        return
      }
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "evil=1" })
      res.end(JSON.stringify({ ok: true }))
    })
  })
  await new Promise<void>((done) => upstream?.listen(0, "127.0.0.1", () => done()))
  const address = upstream.address()
  const port = typeof address === "object" && address ? address.port : 0
  return { origin: `http://127.0.0.1:${port}`, seen, streamClosed }
}

describe("the Studio proxy", () => {
  test("reaches a real hosted Studio through the process runner and lists a project's circuits", async () => {
    const command = await workspaceCli()
    server = await startTestHub({ runner: (key, origin) => createProcessRunner({ publicOrigin: origin, ticketPublicKey: key, command, log: () => undefined }) })
    const ada = await newUser(server, "ada@example.com")
    const id = await projectOf(server, ada, "ada@example.com")
    await writeFile(join(server.hub.files.projectDir(server.hub.store.userByEmail("ada@example.com")?.id as string, id), "main.circuit.tsx"), BOARD)
    const listed = await ada.get(`/p/${id}/api/circuits`, { [TICKET_HEADER]: "forged.ticket" })
    expect(listed.status).toBe(200)
    expect(JSON.parse(listed.text)).toEqual({ ok: true, data: ["main.circuit.tsx"] })
    expect(server.hub.runner.state(id)).toBe("running")
    // Deleting the project stops its workspace.
    await ada.submit("/projects", `/projects/${id}/delete`, { confirm: "Amp" })
    expect(server.hub.runner.state(id)).toBe("stopped")
  })

  test("strips a forged ticket, forwarded host and the cookie, and sets its own one-minute ticket and the public Host", async () => {
    const studio = await recorder()
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin) })
    const ada = await newUser(server, "ada@example.com")
    const id = await projectOf(server, ada, "ada@example.com")
    const answer = await ada.get(`/p/${id}/api/circuits?x=1`, { [TICKET_HEADER]: "forged.ticket", "x-forwarded-host": "evil.example", "x-forwarded-for": "1.2.3.4", authorization: "Bearer x" })
    expect(answer.status).toBe(200)
    expect(answer.headers["set-cookie"]).toBeUndefined()
    const [got] = studio.seen
    expect(got?.url).toBe(`/p/${id}/api/circuits?x=1`)
    expect(got?.headers.host).toBe("cf.example.test")
    expect(got?.headers["x-forwarded-host"]).toBeUndefined()
    expect(got?.headers["x-forwarded-for"]).toBeUndefined()
    expect(got?.headers.cookie).toBeUndefined()
    expect(got?.headers.authorization).toBeUndefined()
    const check = verifyTicket(got?.headers[TICKET_HEADER], ticketPublicKey(server.hub.keys.publicKeyBase64), Math.floor(Date.now() / 1000), id)
    expect(check.ok).toBe(true)
    if (check.ok) {
      expect(check.payload.u).toBe(server.hub.store.userByEmail("ada@example.com")?.id)
      expect(check.payload.exp - check.payload.iat).toBe(60)
    }
  })

  test("refuses a cross-site request before a ticket is signed or a workspace started", async () => {
    const studio = await recorder()
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin) })
    const ada = await newUser(server, "ada@example.com")
    const id = await projectOf(server, ada, "ada@example.com")
    const evil = await ada.post(`/p/${id}/api/edit`, {}, { origin: "https://evil.example" })
    expect(evil.status).toBe(403)
    const noOrigin = await ada.get(`/p/${id}/api/circuits`, { "sec-fetch-site": "cross-site" })
    expect(noOrigin.status).toBe(403)
    expect(studio.seen).toEqual([])
    expect(server.hub.runner.state(id)).toBe("stopped")
    const same = await ada.post(`/p/${id}/api/edit`, {}, { origin: ORIGIN })
    expect(same.status).toBe(200)
    expect(studio.seen.map((s) => s.method)).toEqual(["POST"])
  })

  test("streams server-sent events unbuffered and ends the upstream stream when the client goes away", async () => {
    const studio = await recorder()
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin) })
    const ada = await newUser(server, "ada@example.com")
    const id = await projectOf(server, ada, "ada@example.com")
    const cookie = [...ada.jar].map(([k, v]) => `${k}=${v}`).join("; ")
    const url = new URL(server.url)
    const received = await new Promise<string>((done, fail) => {
      const req = request({ host: url.hostname, port: url.port, path: `/p/${id}/api/events`, headers: { cookie } }, (res) => {
        expect(res.headers["content-type"]).toBe("text/event-stream")
        let text = ""
        res.setEncoding("utf8")
        res.on("data", (chunk: string) => {
          text += chunk
          if (text.includes("event: tick")) {
            req.destroy()
            done(text)
          }
        })
      })
      req.on("error", (error) => (/socket hang up|aborted/.test(error.message) ? undefined : fail(error)))
      req.end()
    })
    expect(received).toContain("event: hello\ndata: 1\n\n")
    await studio.streamClosed
    // Once the stream is over, the workspace counts as idle again (no request holds it).
    expect(server.hub.runner.state(id)).toBe("running")
  })

  test("a request body over 1 MB is refused", async () => {
    const studio = await recorder()
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin) })
    const ada = await newUser(server, "ada@example.com")
    const id = await projectOf(server, ada, "ada@example.com")
    const big = await ada.post(`/p/${id}/api/edit`, { a: "x".repeat(1024 * 1024 + 10) })
    expect(big.status).toBe(413)
  })
})
