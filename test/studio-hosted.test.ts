import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { request } from "node:http"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveCircuit } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import type { DesignBuilder } from "../src/studio/live.js"
import { startStudio, type Studio } from "../src/studio/server.js"
import { signTicket, TICKET_HEADER } from "../src/hosted/ticket.js"
import { BOARD, SHARED } from "./fixtures.js"

const FILE = "main.circuit.tsx"
const KEY = Buffer.from("k".repeat(40))
const PUBLIC = "https://copperflow.example.test"
const HOST = "copperflow.example.test"
const BASE = "/p/demo"
const builder: DesignBuilder = {
  build: async (root, file) => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file),
}
let root: string
let studio: Studio

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-hosted-"))
  const staticDir = join(root, "static")
  await mkdir(staticDir)
  await writeFile(join(staticDir, "index.html"), "<html><body>studio</body></html>")
  await writeFile(join(root, FILE), BOARD)
  await writeFile(join(root, "shared.ts"), SHARED)
  studio = await startStudio({
    root,
    staticDir,
    builder,
    port: 0,
    routeWorker: null,
    placeWorker: null,
    hosted: { bind: "127.0.0.1", publicOrigin: PUBLIC, basePath: BASE, workspaceId: "ws-1", ticketKey: KEY },
  })
})

afterEach(() => studio.close())

const later = () => Math.floor(Date.now() / 1000) + 60
const ticket = (w = "ws-1", exp = later()) => signTicket({ w, u: "user-1", exp }, KEY)

interface Answer {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

/** One request to the workspace as the hub would send it; `stream` resolves on the first chunk. */
function send(path: string, headers: Record<string, string>, stream = false): Promise<Answer> {
  const { port } = new URL(studio.url)
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path, headers }, (res) => {
      let body = ""
      res.setEncoding("utf8")
      res.on("data", (chunk: string) => {
        body += chunk
        if (stream) {
          done({ status: res.statusCode ?? 0, headers: res.headers, body })
          req.destroy()
        }
      })
      res.on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on("error", (error) => (stream ? undefined : fail(error)))
    req.end()
  })
}

const proxied = (extra: Record<string, string> = {}) => ({ host: "127.0.0.1", "x-forwarded-host": HOST, ...extra })

describe("hosted Studio", () => {
  test("opens at the public address under the base path, with no token", () => {
    expect(studio.token).toBe("")
    expect(studio.openUrl).toBe(`${PUBLIC}${BASE}/`)
  })

  test("serves the app under the base path and redirects the bare base path", async () => {
    const page = await send(`${BASE}/`, proxied())
    expect(page.status).toBe(200)
    expect(page.body).toContain("studio")
    const bare = await send(BASE, proxied())
    expect(bare.status).toBe(308)
    expect(bare.headers.location).toBe(`${BASE}/`)
    expect((await send("/", proxied())).status).toBe(404)
    expect((await send("/api/circuits", proxied({ [TICKET_HEADER]: ticket() }))).status).toBe(404)
  })

  test("answers the API with a valid ticket for this workspace", async () => {
    const answer = await send(`${BASE}/api/circuits`, proxied({ [TICKET_HEADER]: ticket() }))
    expect(answer.status).toBe(200)
    expect(JSON.parse(answer.body).data).toEqual([FILE])
    const project = await send(`${BASE}/api/circuit?file=${FILE}`, proxied({ [TICKET_HEADER]: ticket() }))
    expect(JSON.parse(project.body).data.file).toBe(FILE)
  })

  test("refuses a missing, foreign, expired or tampered ticket with a reason that tells nothing of the key", async () => {
    const good = ticket()
    const [body, mac] = good.split(".") as [string, string]
    const forged = Buffer.from(JSON.stringify({ w: "ws-1", u: "someone", exp: later() })).toString("base64url")
    const cases: Array<[Record<string, string>, string]> = [
      [{}, "Missing workspace ticket"],
      [{ [TICKET_HEADER]: ticket("ws-2") }, "The ticket is for another workspace"],
      [{ [TICKET_HEADER]: ticket("ws-1", Math.floor(Date.now() / 1000) - 1) }, "Expired workspace ticket"],
      [{ [TICKET_HEADER]: `${forged}.${mac}` }, "Invalid workspace ticket"],
      [{ [TICKET_HEADER]: `${body}.${mac.slice(0, -2)}AA` }, "Invalid workspace ticket"],
      [{ [TICKET_HEADER]: "not a ticket" }, "Malformed workspace ticket"],
      [{ "x-copperflow-token": "anything" }, "Missing workspace ticket"],
    ]
    for (const [headers, reason] of cases) {
      const answer = await send(`${BASE}/api/circuits`, proxied(headers))
      expect(answer.status).toBe(403)
      expect(JSON.parse(answer.body).error).toBe(reason)
      expect(answer.body).not.toContain(KEY.toString())
    }
  })

  test("refuses a Host or Origin other than the public one", async () => {
    const withTicket = { [TICKET_HEADER]: ticket() }
    expect((await send(`${BASE}/api/circuits`, { host: HOST, ...withTicket })).status).toBe(200)
    expect((await send(`${BASE}/api/circuits`, { host: "127.0.0.1", ...withTicket })).status).toBe(403)
    expect((await send(`${BASE}/api/circuits`, proxied({ "x-forwarded-host": "evil.example", ...withTicket }))).status).toBe(403)
    expect((await send(`${BASE}/api/circuits`, proxied({ origin: "https://evil.example", ...withTicket }))).status).toBe(403)
    expect((await send(`${BASE}/api/circuits`, proxied({ origin: PUBLIC, ...withTicket }))).status).toBe(200)
  })

  test("opens the event stream with a ticket and refuses it without", async () => {
    expect((await send(`${BASE}/api/events`, proxied())).status).toBe(403)
    const stream = await send(`${BASE}/api/events`, proxied({ [TICKET_HEADER]: ticket() }), true)
    expect(stream.status).toBe(200)
    expect(stream.headers["content-type"]).toBe("text/event-stream")
    expect(stream.body).toContain(": connected")
  })
})

describe("local Studio keeps the local rules", () => {
  test("x-forwarded-host is not honoured locally", async () => {
    const staticDir = join(root, "static")
    const local = await startStudio({ root, staticDir, builder, port: 0, routeWorker: null, placeWorker: null })
    try {
      const { port } = new URL(local.url)
      const status = await new Promise<number>((done, fail) => {
        const req = request({ host: "127.0.0.1", port, path: "/api/circuits", headers: { host: HOST, "x-forwarded-host": `127.0.0.1:${port}`, "x-copperflow-token": local.token } }, (res) => {
          res.resume()
          done(res.statusCode ?? 0)
        })
        req.on("error", fail)
        req.end()
      })
      expect(status).toBe(403)
    } finally {
      await local.close()
    }
  })
})
