import { afterEach, describe, expect, test } from "vitest"
import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { runCli } from "../src/cli-commands.js"
import { ticketPublicKey, verifyTicket, TICKET_HEADER } from "../src/hosted/ticket.js"
import { answerHeaders } from "../src/hub/proxy.js"
import { createProcessRunner } from "../src/hub/runner/process-runner.js"
import { ManagedRunner, type Launched } from "../src/hub/runner/runner.js"
import type { HubServer } from "../src/hub/server.js"
import { BOARD } from "./fixtures.js"
import { Browser, fixedRunner, newUser, ORIGIN, projectOriginOf, send, startTestHub } from "./helpers/hub-client.js"
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

type Seen = { method: string; url: string; headers: IncomingHttpHeaders; body: string }

/** A stand-in Studio that records what reaches it; /api/events streams until the client goes away. */
async function recorder(extraHeaders: Record<string, string> = {}): Promise<{ origin: string; seen: Seen[]; streamClosed: Promise<void> }> {
  const seen: Seen[] = []
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
      res.writeHead(200, { "content-type": "application/json", "set-cookie": "evil=1", ...extraHeaders })
      res.end(JSON.stringify({ ok: true }))
    })
  })
  await new Promise<void>((done) => upstream?.listen(0, "127.0.0.1", () => done()))
  const address = upstream.address()
  const port = typeof address === "object" && address ? address.port : 0
  return { origin: `http://127.0.0.1:${port}`, seen, streamClosed }
}

/** A signed-in owner who has entered project `id`'s origin. */
async function entered(hub: HubServer): Promise<{ ada: Browser; id: string }> {
  const ada = await newUser(hub, "ada@example.com")
  const id = await projectOf(hub, ada, "ada@example.com")
  const { handover, entered: answer } = await ada.openProject(id)
  expect(handover.status).toBe(303)
  expect(answer?.status).toBe(303)
  expect(answer?.headers.location).toBe("/")
  return { ada, id }
}

/** Opens the events stream on the project origin; resolves on the first event; `ended` settles when it is cut. */
async function openStream(hubUrl: string, id: string, cookie: string): Promise<{ ended: Promise<void> }> {
  const url = new URL(hubUrl)
  return new Promise((done, fail) => {
    const req = request({ agent: false, host: url.hostname, port: url.port, path: "/api/events", headers: { host: new URL(projectOriginOf(id)).host, cookie } }, (res) => {
      const ended = new Promise<void>((over) => {
        res.on("close", () => over())
        res.on("error", () => over())
      })
      res.once("data", () => done({ ended }))
    })
    req.on("error", (error) => (/socket hang up|aborted|ECONNRESET/.test(error.message) ? undefined : fail(error)))
    req.end()
  })
}

describe("workspaces on their own origins", () => {
  test("/p/<id>/ hands the owner over with a one-time token; the project origin sets its own cookie", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const id = await projectOf(server, ada, "ada@example.com")
    const handover = await ada.get(`/p/${id}/`)
    const location = new URL(String(handover.headers.location))
    expect(location.origin).toBe(projectOriginOf(id))
    expect(location.pathname).toBe("/_enter")
    const path = `${location.pathname}${location.search}`
    const enter = await ada.onProject(id, "GET", path)
    expect(String(enter.headers["set-cookie"])).toMatch(/^__Host-copperflow-workspace=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=43200; HttpOnly; SameSite=Lax; Secure$/)
    // Single use.
    expect((await new Browser(server.url).onProject(id, "GET", path)).status).toBe(404)
    // Another project's origin does not take this project's token.
    const other = await projectOf(server, ada, "ada@example.com").then(async () => {
      await ada.submit("/projects", "/projects", { name: "Second" })
      return server?.hub.store.projects(server.hub.store.userByEmail("ada@example.com")?.id as string).find((p) => p.name === "Second")?.id as string
    })
    const again = new URL(String((await ada.get(`/p/${id}/`)).headers.location))
    expect((await ada.onProject(other, "GET", `${again.pathname}${again.search}`)).status).toBe(404)
  })

  test("a token older than 30 seconds is refused", async () => {
    let now = Date.now()
    server = await startTestHub({ now: () => now })
    const ada = await newUser(server, "ada@example.com")
    const id = await projectOf(server, ada, "ada@example.com")
    const location = new URL(String((await ada.get(`/p/${id}/`)).headers.location))
    now += 31_000
    expect((await ada.onProject(id, "GET", `${location.pathname}${location.search}`)).status).toBe(404)
  })

  test("the hub's pages are never served on a project origin, and the public origin never proxies", async () => {
    const studio = await recorder()
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin) })
    const { ada, id } = await entered(server)
    for (const path of ["/projects", "/account", "/signin", "/static/hub.css"]) {
      expect((await ada.onProject(id, "GET", path)).text).not.toContain("<h1>")
    }
    expect(studio.seen.map((s) => s.url)).toEqual(["/projects", "/account", "/signin", "/static/hub.css"])
    studio.seen.length = 0
    expect((await ada.get(`/p/${id}/api/circuits`)).status).toBe(303)
    expect((await ada.post(`/p/${id}/api/edit`, {})).status).toBe(404)
    expect(studio.seen).toEqual([])
    // An unknown host is neither.
    expect((await send(server.url, "GET", "/", { host: "evil.example" })).status).toBe(404)
  })

  test("a project origin answers only its owner's workspace cookie, checked against the project in the Host", async () => {
    const studio = await recorder()
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin) })
    const { ada, id } = await entered(server)
    expect((await ada.onProject(id, "GET", "/api/circuits")).status).toBe(200)
    const nobody = new Browser(server.url)
    expect((await nobody.onProject(id, "GET", "/api/circuits")).status).toBe(404)
    expect((await nobody.onProject(id, "GET", "/")).headers.location).toBe(`${ORIGIN}/p/${id}/`)
    const bob = await newUser(server, "bob@example.com")
    for (const [name, value] of ada.jar) if (name.includes("workspace")) bob.jar.set(name, value)
    const bobProject = await projectOf(server, bob, "bob@example.com")
    // Ada's workspace cookie does not open Bob's project, and Bob cannot open Ada's.
    expect((await bob.onProject(bobProject, "GET", "/api/circuits")).status).toBe(404)
    expect((await new Browser(server.url).get(`/p/${id}/`)).headers.location).toBe("/signin")
    expect((await bob.get(`/p/${id}/`)).status).toBe(404)
    // The cookie twice is no cookie.
    const cookie = `__Host-copperflow-workspace=${ada.jar.get("__Host-copperflow-workspace")}`
    expect((await send(server.url, "GET", "/api/circuits", { host: new URL(projectOriginOf(id)).host, cookie: `${cookie}; ${cookie}` })).status).toBe(404)
  })

  test("reaches a real hosted Studio through the process runner and lists a project's circuits", async () => {
    const command = await workspaceCli()
    server = await startTestHub({ runner: (key) => createProcessRunner({ ticketPublicKey: key, command, log: () => undefined }) })
    const { ada, id } = await entered(server)
    await writeFile(join(server.hub.files.projectDir(server.hub.store.userByEmail("ada@example.com")?.id as string, id), "main.circuit.tsx"), BOARD)
    const listed = await ada.onProject(id, "GET", "/api/circuits", { [TICKET_HEADER]: "forged.ticket" })
    expect(listed.status).toBe(200)
    expect(JSON.parse(listed.text)).toEqual({ ok: true, data: ["main.circuit.tsx"] })
    expect(server.hub.runner.state(id)).toBe("running")
    await ada.submit("/projects", `/projects/${id}/delete`, { confirm: "Amp" })
    expect(server.hub.runner.state(id)).toBe("stopped")
  })

  test("strips a forged ticket, forwarded host and cookies, and sets its own one-minute ticket and the project Host", async () => {
    const studio = await recorder()
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin) })
    const { ada, id } = await entered(server)
    const answer = await ada.onProject(id, "GET", "/api/circuits?x=1", { [TICKET_HEADER]: "forged.ticket", "x-forwarded-host": "evil.example", "x-forwarded-for": "1.2.3.4", authorization: "Bearer x" })
    expect(answer.status).toBe(200)
    expect(answer.headers["set-cookie"]).toBeUndefined()
    const [got] = studio.seen
    expect(got?.url).toBe("/api/circuits?x=1")
    expect(got?.headers.host).toBe(new URL(projectOriginOf(id)).host)
    expect(got?.headers["x-forwarded-host"]).toBeUndefined()
    expect(got?.headers["x-forwarded-for"]).toBeUndefined()
    expect(got?.headers.cookie).toBeUndefined()
    expect(got?.headers.authorization).toBeUndefined()
    const check = verifyTicket(got?.headers[TICKET_HEADER], ticketPublicKey(server.hub.keys.publicKeyBase64), Math.floor(Date.now() / 1000), id)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.payload.exp - check.payload.iat).toBe(60)
  })

  test("only allowed response headers come back, with nosniff, the frame rule and a same-origin Location", async () => {
    const studio = await recorder({ "clear-site-data": '"cookies"', refresh: "0;url=https://evil.example", "access-control-allow-origin": "*", etag: '"1"' })
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin) })
    const { ada, id } = await entered(server)
    const answer = await ada.onProject(id, "GET", "/api/circuits")
    expect(answer.headers["clear-site-data"]).toBeUndefined()
    expect(answer.headers.refresh).toBeUndefined()
    expect(answer.headers["access-control-allow-origin"]).toBeUndefined()
    expect(answer.headers.etag).toBe('"1"')
    expect(answer.headers["x-content-type-options"]).toBe("nosniff")
    expect(answer.headers["content-security-policy"]).toBe(`frame-ancestors ${ORIGIN}`)
    const target = { projectOrigin: projectOriginOf(id), frameAncestor: ORIGIN }
    expect(answerHeaders({ location: "/p/x/" }, target).location).toBe("/p/x/")
    expect(answerHeaders({ location: "https://evil.example/" }, target).location).toBeUndefined()
    expect(answerHeaders({ location: "//evil.example/" }, target).location).toBeUndefined()
  })

  test("refuses a cross-site request before a ticket is signed or a workspace started", async () => {
    const studio = await recorder()
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin) })
    const { ada, id } = await entered(server)
    expect((await ada.onProject(id, "POST", "/api/edit", { origin: "https://evil.example" }, "{}")).status).toBe(403)
    expect((await ada.onProject(id, "POST", "/api/edit", { origin: ORIGIN }, "{}")).status).toBe(403)
    expect((await ada.onProject(id, "GET", "/api/circuits", { "sec-fetch-site": "cross-site" })).status).toBe(403)
    expect(studio.seen).toEqual([])
    expect(server.hub.runner.state(id)).toBe("stopped")
    expect((await ada.onProject(id, "POST", "/api/edit", {}, "{}")).status).toBe(200)
    expect(studio.seen.map((s) => s.method)).toEqual(["POST"])
  })

  test("streams server-sent events unbuffered and ends the upstream stream when the client goes away", async () => {
    const studio = await recorder()
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin) })
    const { ada, id } = await entered(server)
    const url = new URL(server.url)
    const received = await new Promise<string>((done, fail) => {
      const req = request({ agent: false, host: url.hostname, port: url.port, path: "/api/events", headers: { host: new URL(projectOriginOf(id)).host, cookie: ada.cookie() } }, (res) => {
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
    expect(server.hub.runner.state(id)).toBe("running")
  })

  test("sign-out cuts the user's open streams, ends their workspace cookies and stops their workspaces", async () => {
    const studio = await recorder()
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin) })
    const { ada, id } = await entered(server)
    const stream = await openStream(server.url, id, ada.cookie())
    const workspaceCookie = ada.cookie()
    await ada.submit("/projects", "/signout", {})
    await stream.ended
    await studio.streamClosed
    expect(server.hub.runner.state(id)).toBe("stopped")
    expect((await send(server.url, "GET", "/api/circuits", { host: new URL(projectOriginOf(id)).host, cookie: workspaceCookie })).status).toBe(404)
  })

  test("a maintainer's reset-password cuts the streams in the running hub at its next sweep", async () => {
    const studio = await recorder()
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin), sweepMs: 50 })
    const { ada, id } = await entered(server)
    const stream = await openStream(server.url, id, ada.cookie())
    const data = join(server.hub.files.root, "..")
    expect(await runCli(["hub", "reset-password", "ada@example.com", "--data", data], "/", { out: () => undefined, err: () => undefined })).toBe(0)
    await stream.ended
    expect(server.hub.runner.state(id)).toBe("stopped")
  })

  test("a sign-out while the workspace is starting means no upstream request and no ticket", async () => {
    const studio = await recorder()
    let release!: () => void
    const gate = new Promise<void>((done) => (release = done))
    const slow = () =>
      new ManagedRunner({
        launch: async (): Promise<Launched> => {
          await gate
          return { address: { studio: studio.origin, mcp: studio.origin }, exited: new Promise(() => undefined), stop: async () => undefined }
        },
        log: () => undefined,
      })
    server = await startTestHub({ runner: slow })
    const { ada, id } = await entered(server)
    const pending = ada.onProject(id, "GET", "/api/circuits")
    await new Promise((done) => setTimeout(done, 50))
    // Sign-out revokes at once; stopping the workspace waits for its start to finish.
    const signingOut = ada.submit("/projects", "/signout", {})
    await new Promise((done) => setTimeout(done, 50))
    release()
    await signingOut
    expect((await pending).status).toBe(404)
    expect(studio.seen).toEqual([])
  })

  test("a request body over 1 MB is refused", async () => {
    const studio = await recorder()
    server = await startTestHub({ runner: () => fixedRunner(() => studio.origin) })
    const { ada, id } = await entered(server)
    const big = await ada.onProject(id, "POST", "/api/edit", {}, "x".repeat(1024 * 1024 + 10))
    expect(big.status).toBe(413)
  })

  test("the certificate check answers only the public host and existing projects", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const id = await projectOf(server, ada, "ada@example.com")
    const ask = (domain: string) => new Browser(server?.url as string).get(`/_tls-ask?domain=${encodeURIComponent(domain)}`)
    expect((await ask("cf.example.test")).status).toBe(200)
    expect((await ask(`${id}.ws.localhost`)).status).toBe(200)
    expect((await ask(`${"0".repeat(32)}.ws.localhost`)).status).toBe(404)
    expect((await ask("evil.example")).status).toBe(404)
    expect((await ask(`x.${id}.ws.localhost`)).status).toBe(404)
  })
})
