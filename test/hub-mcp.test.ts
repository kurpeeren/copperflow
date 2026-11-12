import { afterEach, describe, expect, test } from "vitest"
import { createServer, type IncomingHttpHeaders, type Server } from "node:http"
import { existsSync } from "node:fs"
import { connect } from "node:net"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { tmpdir } from "node:os"
import { readdir } from "node:fs/promises"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { ticketPublicKey, verifyTicket, TICKET_HEADER } from "../src/hosted/ticket.js"
import { createProcessRunner } from "../src/hub/runner/process-runner.js"
import type { HubServer } from "../src/hub/server.js"
import { Browser, fixedRunner, newUser, ORIGIN, projectOriginOf, send, startTestHub } from "./helpers/hub-client.js"
import { call, connectAgent } from "./helpers/hub-mcp.js"
import { workspaceCli } from "./helpers/workspace-cli.js"

const HOST = new URL(ORIGIN).host
/** What an agent pays to connect at the hub: instructions + tools/list as JSON (42 725 on 2026-11-12, 43 321 once the tools state their limits), and the first guide answer (15 390). */
const HUB_INSTRUCTIONS_AND_TOOLS_BUDGET = 43_500
const GUIDE_BUDGET = 16_000

let server: HubServer | undefined
let upstream: Server | undefined
const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined)
  await server?.close()
  server = undefined
  upstream?.closeAllConnections()
  await new Promise<void>((done) => (upstream ? upstream.close(() => done()) : done()))
  upstream = undefined
})

async function tokenFor(browser: Browser, name = "agent"): Promise<string> {
  const made = await browser.submit("/account", "/account/tokens", { name, password: "a good password" })
  return /cfp_[A-Za-z0-9_-]{43}/.exec(made.text)?.[0] as string
}

async function agent(hub: HubServer, token: string): Promise<Client> {
  const client = await connectAgent(hub, token)
  clients.push(client)
  return client
}

const initialize = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "0" } } })
const post = (hub: HubServer, headers: Record<string, string>, host = HOST) =>
  send(hub.url, "POST", "/mcp", { host, "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, initialize)

describe("the hub's /mcp", () => {
  test("refuses without a valid bearer token, a cookie never counts, and a refused token is audited without the token", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const none = await post(server, {})
    expect(none.status).toBe(401)
    expect(none.headers["www-authenticate"]).toBe(`Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource"`)
    expect((await post(server, { cookie: ada.cookie() })).status).toBe(401)
    const forged = `cfp_${"A".repeat(43)}`
    expect((await post(server, { authorization: `Bearer ${forged}` })).status).toBe(401)
    const log = server.hub.store.auditLog(50)
    expect(log.map((e) => e.event)).toContain("token-refused")
    expect(JSON.stringify(log)).not.toContain(forged)
    const token = await tokenFor(ada)
    expect((await post(server, { authorization: `Bearer ${token}` })).status).toBe(200)
    // Never on a project origin.
    expect((await post(server, { authorization: `Bearer ${token}` }, new URL(projectOriginOf("0".repeat(32))).host)).status).toBe(404)
    // Two Authorization headers are refused, even when the first is valid.
    const port = Number(new URL(server.url).port)
    const raw = await new Promise<string>((done, fail) => {
      const socket = connect(port, "127.0.0.1", () =>
        socket.end(`POST /mcp HTTP/1.1\r\nhost: ${HOST}\r\nauthorization: Bearer ${token}\r\nAuthorization: Bearer ${forged}\r\ncontent-type: application/json\r\naccept: application/json, text/event-stream\r\ncontent-length: ${Buffer.byteLength(initialize)}\r\nconnection: close\r\n\r\n${initialize}`),
      )
      let text = ""
      socket.on("data", (chunk: Buffer) => (text += chunk.toString()))
      socket.on("end", () => done(text))
      socket.on("error", fail)
    })
    expect(raw.split("\r\n")[0]).toBe("HTTP/1.1 400 Bad Request")
  })

  test("an initialise the transport refuses leaves no server or transport behind", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const token = await tokenFor(ada)
    // No Accept header: the transport refuses it before any session exists.
    const refused = await send(server.url, "POST", "/mcp", { host: HOST, "content-type": "application/json", authorization: `Bearer ${token}` }, initialize)
    expect(refused.status).toBe(406)
    expect(server.hub.agents.size).toBe(0)
    expect(server.hub.agents.servers).toBe(0)
    expect((await post(server, { authorization: `Bearer ${token}` })).status).toBe(200)
    expect(server.hub.agents.servers).toBe(1)
  })

  test("project tools, guide, and a forwarded tool before any project is open", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const client = await agent(server, await tokenFor(ada))
    expect((await call(client, "list_projects")).text).toContain("no projects yet")
    expect((await call(client, "guide")).text).toContain("copperflow")
    const early = await call(client, "new_circuit", { file: "a.circuit.tsx", parts: [], nets: {} })
    expect(early.isError).toBe(true)
    for (const name of ["list_projects", "new_project", "open_project"]) expect(early.text).toContain(name)
    const made = await call(client, "new_project", { name: "Amp" })
    const id = server.hub.store.projects(server.hub.store.userByEmail("ada@example.com")?.id as string)[0]?.id as string
    expect(made.text).toBe(`Project "Amp" created and open (id ${id}). The person watches it at ${ORIGIN}/p/${id}/`)
    expect((await call(client, "list_projects")).text).toBe(`Your projects (1 of 20):\n- Amp (id ${id}, 0 circuits, 0 parts) [open]`)
    expect((await call(client, "new_project", { name: "Amp" })).text).toContain("already have a project with that name")
    expect((await call(client, "open_project", { name: "Amp" })).isError).toBe(false)
    expect((await call(client, "open_project", {})).isError).toBe(true)
    expect((await ada.get("/projects")).text).toContain("Amp")
  })

  test("project names are unique regardless of case, on the pages and through the tools; an ambiguous legacy name asks for the id", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    expect((await ada.submit("/projects", "/projects", { name: "Amp" })).status).toBe(303)
    expect((await ada.submit("/projects", "/projects", { name: "amp" })).status).toBe(409)
    await ada.submit("/projects", "/projects", { name: "Other" })
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    const other = server.hub.store.projects(userId).find((p) => p.name === "Other")?.id as string
    expect((await ada.submit("/projects", `/projects/${other}/rename`, { name: "AMP" })).status).toBe(409)
    const client = await agent(server, await tokenFor(ada))
    expect((await call(client, "new_project", { name: "aMp" })).text).toContain("already have a project with that name")
    expect((await call(client, "open_project", { name: "amp" })).isError).toBe(false)
    // A name pair made before this rule (written straight into the database).
    const db = new DatabaseSync(join(server.hub.files.root, "..", "hub.db"))
    db.prepare("INSERT INTO projects (id, user_id, name, created) VALUES (?, ?, ?, ?)").run("a".repeat(32), userId, "AMP", 0)
    db.close()
    const ambiguous = await call(client, "open_project", { name: "Amp" })
    expect(ambiguous.isError).toBe(true)
    expect(ambiguous.text).toContain(`(id ${"a".repeat(32)})`)
    expect(ambiguous.text).toContain("Open one by its id")
  })

  test("another user's project by id or name is not found", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const bob = await newUser(server, "bob@example.com")
    await bob.submit("/projects", "/projects", { name: "Secret" })
    const bobProject = server.hub.store.projects(server.hub.store.userByEmail("bob@example.com")?.id as string)[0]?.id as string
    const client = await agent(server, await tokenFor(ada))
    const byId = await call(client, "open_project", { id: bobProject })
    const byName = await call(client, "open_project", { name: "Secret" })
    const nothing = await call(client, "open_project", { id: "f".repeat(32) })
    expect(byId).toEqual(nothing)
    expect(byName).toEqual({ isError: true, text: "There is no such project. Call list_projects to see yours." })
    expect((await call(client, "list_projects")).text).not.toContain("Secret")
  })

  test("at most 60 tool calls a minute per user, refused inside the tool answer with the wait", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const client = await agent(server, await tokenFor(ada))
    for (let i = 0; i < 60; i += 1) expect((await call(client, "list_projects")).isError).toBe(false)
    const refused = await call(client, "list_projects")
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/^429 Too many tool calls: at most 60 a minute\. Wait \d+ s, then call again\.$/)
    expect(server.hub.store.auditLog(5).map((e) => e.event)).toContain("tool-calls-limited")
  })

  test("at most 600 /mcp requests a minute per user, and a token's last use is written at most once a minute", async () => {
    let clock = Date.now()
    server = await startTestHub({ now: () => clock })
    const ada = await newUser(server, "ada@example.com")
    const token = await tokenFor(ada)
    const client = await agent(server, token)
    const userId = server.hub.store.userByEmail("ada@example.com")?.id as string
    const lastUsed = () => server?.hub.store.tokens.personalTokens(userId)[0]?.lastUsed
    const first = lastUsed()
    expect(first).toBe(clock)
    clock += 30_000
    await client.listTools()
    expect(lastUsed()).toBe(first)
    clock += 31_000
    await client.listTools()
    expect(lastUsed()).toBe(clock)
    let refused = 0
    for (let i = 0; i < 600 && refused === 0; i += 1) await client.listTools().catch(() => (refused = i))
    expect(refused).toBeGreaterThan(590)
    // Refused before the body is read or parsed: a body that is not JSON gets 429, not 400.
    const big = await send(server.url, "POST", "/mcp", { host: HOST, "content-type": "application/json", authorization: `Bearer ${token}` }, "x".repeat(64 * 1024))
    expect(big.status).toBe(429)
  })

  test("what an agent pays to connect at the hub, and the tool list is read without making the catalog folder", async () => {
    server = await startTestHub()
    const ada = await newUser(server, "ada@example.com")
    const client = await agent(server, await tokenFor(ada))
    const instructions = client.getInstructions() ?? ""
    expect(instructions).toContain(`${ORIGIN}/p/<project id>/`)
    const listed = await client.listTools()
    const names = listed.tools.map((t) => t.name)
    expect(names.slice(0, 3)).toEqual(["list_projects", "new_project", "open_project"])
    expect(names).toContain("guide")
    expect(names).not.toContain("import_part")
    const size = instructions.length + JSON.stringify(listed).length
    const guide = (await call(client, "guide")).text.length
    expect(size).toBeLessThanOrEqual(HUB_INSTRUCTIONS_AND_TOOLS_BUDGET)
    expect(guide).toBeLessThanOrEqual(GUIDE_BUDGET)
    expect((await readdir(tmpdir())).some((name) => name.startsWith("copperflow-hub-catalog-") && existsSync(`${tmpdir()}/${name}`))).toBe(false)
  })

  test("a token of user A reaches only A's own project: every ticket the workspace sees names A and A's project", async () => {
    const seen: IncomingHttpHeaders[] = []
    upstream = createServer((req, res) => {
      seen.push(req.headers)
      req.resume()
      res.writeHead(500).end()
    })
    await new Promise<void>((done) => upstream?.listen(0, "127.0.0.1", () => done()))
    const port = (upstream.address() as { port: number }).port
    server = await startTestHub({ runner: () => fixedRunner(() => `http://127.0.0.1:${port}`) })
    const ada = await newUser(server, "ada@example.com")
    const bob = await newUser(server, "bob@example.com")
    await bob.submit("/projects", "/projects", { name: "Bobs" })
    const client = await agent(server, await tokenFor(ada))
    await call(client, "new_project", { name: "Amp" })
    const adaId = server.hub.store.userByEmail("ada@example.com")?.id as string
    const adaProject = server.hub.store.projects(adaId)[0]?.id as string
    const answer = await call(client, "project_status")
    expect(answer).toEqual({ isError: true, text: "The workspace did not answer. Try again in a moment." })
    expect(seen.length).toBeGreaterThan(0)
    const key = ticketPublicKey(server.hub.keys.publicKeyBase64)
    for (const headers of seen) {
      expect(headers.host).toBe(new URL(projectOriginOf(adaProject)).host)
      expect(headers.authorization).toBeUndefined()
      const check = verifyTicket(headers[TICKET_HEADER], key, Math.floor(Date.now() / 1000), adaProject)
      expect(check.ok && check.payload.u).toBe(adaId)
    }
  })
})

describe("one upstream connection per agent session", () => {
  test("10 parallel forwarded calls right after open_project start exactly one workspace MCP session", async () => {
    let initialises = 0
    upstream = createServer((req, res) => {
      let body = ""
      req.on("data", (chunk: Buffer) => (body += chunk.toString()))
      req.on("end", () => {
        if (body.includes('"initialize"')) initialises += 1
        // Slow, so every call arrives while the first connect is still waiting.
        setTimeout(() => res.writeHead(500).end(), 100)
      })
    })
    await new Promise<void>((done) => upstream?.listen(0, "127.0.0.1", () => done()))
    const port = (upstream.address() as { port: number }).port
    server = await startTestHub({ runner: () => fixedRunner(() => `http://127.0.0.1:${port}`) })
    const ada = await newUser(server, "ada@example.com")
    const client = await agent(server, await tokenFor(ada))
    await call(client, "new_project", { name: "Amp" })
    await call(client, "open_project", { name: "Amp" })
    const answers = await Promise.all(Array.from({ length: 10 }, () => call(client, "project_status")))
    expect(answers.every((a) => a.isError)).toBe(true)
    expect(initialises).toBe(1)
  })
})

describe("the whole flow against a real workspace", () => {
  test("a personal token, guide, new_project, new_circuit with two parts, check_circuit, list_projects, and the project in the person's pages", async () => {
    const command = await workspaceCli()
    server = await startTestHub({ runner: (key) => createProcessRunner({ ticketPublicKey: key, command, log: () => undefined }) })
    const ada = await newUser(server, "ada@example.com")
    const client = await agent(server, await tokenFor(ada))
    expect((await call(client, "guide")).isError).toBe(false)
    expect((await call(client, "new_project", { name: "Divider" })).isError).toBe(false)
    const made = await call(client, "new_circuit", {
      file: "main.circuit.tsx",
      parts: [{ name: "R1", kind: "resistor", value: "1k", footprint: "0603" }, { name: "C1", kind: "capacitor", value: "1uF", footprint: "0603" }],
      nets: { VIN: ["R1.pin1"], VOUT: ["R1.pin2", "C1.pin1"], GND: ["C1.pin2"] },
    })
    expect(made.isError, made.text).toBe(false)
    const checked = await call(client, "check_circuit", { file: "main.circuit.tsx" })
    expect(checked.text.length).toBeGreaterThan(0)
    expect((await call(client, "list_projects")).text).toMatch(/- Divider \(id [0-9a-f]{32}, 1 circuit, 0 parts\) \[open\]/)
    const page = await ada.get("/projects")
    expect(page.text).toContain("Divider")
  }, 120_000)
})
