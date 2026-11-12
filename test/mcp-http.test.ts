import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createServer, request } from "node:http"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { startMcpHttp, type McpHttp, type McpHttpOptions } from "../src/hosted/mcp-http.js"
import { generateTicketKeys, signTicket, TICKET_HEADER } from "../src/hosted/ticket.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const DEMO = join(import.meta.dirname, "..", "examples", "usb-c-ldo")
const KEYS = generateTicketKeys()
const FILE = "index.circuit.tsx"
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x", version: "1" } } }

async function demoCopy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cf-mcp-http-"))
  await cp(DEMO, root, { recursive: true })
  return root
}

const now = () => Math.floor(Date.now() / 1000)
const ticket = (over: { w?: string; u?: string; exp?: number } = {}) =>
  signTicket({ w: over.w ?? "ws-1", u: over.u ?? "user-1", iat: now(), exp: over.exp ?? now() + 300 }, KEYS.privateKey)
/** The hub forwards Host as the public host; here the public origin is the test server's own address. */
const proxied = (extra: Record<string, string> = {}) => ({ ...extra })

/** A port nothing listens on now, so the public origin can name it before the server starts. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer()
    probe.once("error", fail)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      const port = typeof address === "object" && address ? address.port : 0
      probe.close(() => done(port))
    })
  })
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

let http: McpHttp
let roots: string[]

async function start(extra: Partial<McpHttpOptions> = {}): Promise<McpHttp> {
  const root = roots[1] as string
  const port = await freePort()
  return startMcpHttp({
    port,
    makeServer: () => createCopperflowServer(root, { engine: inProcessEngine, hosted: true }),
    ticket: { publicKey: KEYS.publicKey, workspaceId: "ws-1" },
    publicOrigin: `http://127.0.0.1:${port}`,
    ...extra,
  })
}

beforeEach(async () => {
  roots = [await demoCopy(), await demoCopy()]
  http = await start()
})
afterEach(() => http.close())

async function httpClient(headers: Record<string, string>, server = http): Promise<Client> {
  const client = new Client({ name: "test", version: "0.0.0" })
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }))
  return client
}

function post(body: unknown, headers: Record<string, string>, server = http) {
  return fetch(server.url, { method: "POST", headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) })
}

describe("MCP over HTTP", () => {
  test("answers circuit_summary, check_circuit and new_circuit as the local server does on the demo project", async () => {
    const server = createCopperflowServer(roots[0] as string, { engine: inProcessEngine, hosted: true })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const local = new Client({ name: "test", version: "0.0.0" })
    await Promise.all([server.connect(serverSide), local.connect(clientSide)])
    const remote = await httpClient(proxied({ [TICKET_HEADER]: ticket() }))
    try {
      const circuit = {
        file: "second.circuit.tsx",
        board: { width: 40, height: 30 },
        parts: [
          { name: "R1", kind: "resistor", value: "10k", footprint: "0402" },
          { name: "R2", kind: "resistor", value: "1k", footprint: "0402" },
        ],
        nets: { MID: ["R1.pin2", "R2.pin1"], GND: ["R2.pin2"] },
      }
      for (const [name, args] of [["circuit_summary", { file: FILE }], ["check_circuit", { file: FILE }], ["new_circuit", circuit], ["list_circuits", {}]] as const) {
        const a = await call(local, name, args)
        expect(await call(remote, name, args), name).toEqual(a)
        expect(a.isError, a.text).toBe(false)
      }
      expect(await readFile(join(roots[1] as string, "second.circuit.tsx"), "utf8")).toBe(await readFile(join(roots[0] as string, "second.circuit.tsx"), "utf8"))
    } finally {
      await remote.close()
      await local.close()
    }
  })

  test("refuses no ticket, another workspace's, a foreign Origin and a foreign Host", async () => {
    const cases: Array<[Record<string, string>, string]> = [
      [proxied(), "Missing workspace ticket"],
      [proxied({ [TICKET_HEADER]: ticket({ w: "ws-2" }) }), "The ticket is for another workspace"],
      [proxied({ [TICKET_HEADER]: ticket(), origin: "https://evil.example" }), "Cross-origin requests are not allowed"],
    ]
    for (const [headers, reason] of cases) {
      const response = await post(INIT, headers)
      expect(response.status).toBe(403)
      const text = await response.text()
      expect(JSON.parse(text).error.message).toBe(reason)
      expect(text).not.toContain(KEYS.publicKeyBase64)
    }
    expect((await post(INIT, proxied({ [TICKET_HEADER]: ticket(), origin: new URL(http.url).origin }))).status).toBe(200)
  })

  test("reads the Host header only, as the SDK's allowed-hosts check does; x-forwarded-host counts for nothing", async () => {
    const { port } = new URL(http.url)
    const send = (headers: Record<string, string>) =>
      new Promise<{ status: number; body: string }>((done, fail) => {
        const body = JSON.stringify(INIT)
        const all = { ...headers, [TICKET_HEADER]: ticket(), "content-type": "application/json", accept: "application/json, text/event-stream", "content-length": String(Buffer.byteLength(body)) }
        const req = request({ host: "127.0.0.1", port, path: "/mcp", method: "POST", headers: all }, (res) => {
          let text = ""
          res.setEncoding("utf8")
          res.on("data", (chunk: string) => (text += chunk))
          res.on("end", () => done({ status: res.statusCode ?? 0, body: text }))
        })
        req.on("error", fail)
        req.end(body)
      })
    const foreign = await send({ host: "evil.example" })
    expect(foreign.status).toBe(403)
    expect(JSON.parse(foreign.body).error.message).toBe("Unexpected Host header")
    expect((await send({ host: "evil.example", "x-forwarded-host": `127.0.0.1:${port}` })).status).toBe(403)
    expect((await send({ host: `127.0.0.1:${port}`, "x-forwarded-host": "evil.example" })).status).toBe(200)
  })

  test("session limits are per user: one user's initialises never close another user's session", async () => {
    const opened = await post(INIT, proxied({ [TICKET_HEADER]: ticket({ u: "alice" }) }))
    const alice = opened.headers.get("mcp-session-id") as string
    for (let i = 0; i < 16; i++) expect((await post(INIT, proxied({ [TICKET_HEADER]: ticket({ u: "bob" }) }))).status).toBe(200)
    expect(http.sessions()).toBe(5)
    const list = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
    const still = await post(list, proxied({ "mcp-session-id": alice, "mcp-protocol-version": "2025-03-26", [TICKET_HEADER]: ticket({ u: "alice" }) }))
    expect(still.status).toBe(200)
  })

  test("20 concurrent initialises by one user never leave more than the per-user limit", async () => {
    const answers = await Promise.all(Array.from({ length: 20 }, () => post(INIT, proxied({ [TICKET_HEADER]: ticket({ u: "eve" }) }))))
    const statuses = answers.map((answer) => answer.status)
    expect(statuses.every((status) => status === 200 || status === 429)).toBe(true)
    expect(statuses.filter((status) => status === 200).length).toBeGreaterThanOrEqual(4)
    expect(http.sessions()).toBeLessThanOrEqual(4)
  })

  test("a failed initialise gives its reservation back", async () => {
    let fail = true
    const root = roots[1] as string
    const port = await freePort()
    const flaky = await startMcpHttp({
      port,
      makeServer: () => {
        if (fail) {
          fail = false
          throw new Error("could not start")
        }
        return createCopperflowServer(root, { engine: inProcessEngine, hosted: true })
      },
      ticket: { publicKey: KEYS.publicKey, workspaceId: "ws-1" },
      publicOrigin: `http://127.0.0.1:${port}`,
      maxSessionsPerUser: 1,
    })
    try {
      expect((await post(INIT, proxied({ [TICKET_HEADER]: ticket() }), flaky)).status).toBe(500)
      expect((await post(INIT, proxied({ [TICKET_HEADER]: ticket() }), flaky)).status).toBe(200)
      expect(flaky.sessions()).toBe(1)
    } finally {
      await flaky.close()
    }
  })

  test("every session closes at its absolute lifetime, and a full server makes room from a user above their fair share", async () => {
    const short = await start({ lifetimeMs: 300 })
    try {
      expect((await post(INIT, proxied({ [TICKET_HEADER]: ticket() }), short)).status).toBe(200)
      expect(short.sessions()).toBe(1)
      await new Promise((done) => setTimeout(done, 600))
      expect(short.sessions()).toBe(0)
    } finally {
      await short.close()
    }
    const shared = await start({ maxSessions: 4, maxSessionsPerUser: 4 })
    try {
      for (let i = 0; i < 3; i++) expect((await post(INIT, proxied({ [TICKET_HEADER]: ticket({ u: "hog" }) }), shared)).status).toBe(200)
      expect((await post(INIT, proxied({ [TICKET_HEADER]: ticket({ u: "fair" }) }), shared)).status).toBe(200)
      expect((await post(INIT, proxied({ [TICKET_HEADER]: ticket({ u: "new" }) }), shared)).status).toBe(200)
      expect(shared.sessions()).toBe(4)
    } finally {
      await shared.close()
    }
  })

  test("the whole server's cap answers 429 without closing anyone's session", async () => {
    const small = await start({ maxSessions: 2, maxSessionsPerUser: 2 })
    try {
      expect((await post(INIT, proxied({ [TICKET_HEADER]: ticket({ u: "alice" }) }), small)).status).toBe(200)
      expect((await post(INIT, proxied({ [TICKET_HEADER]: ticket({ u: "carol" }) }), small)).status).toBe(200)
      const refused = await post(INIT, proxied({ [TICKET_HEADER]: ticket({ u: "bob" }) }), small)
      expect(refused.status).toBe(429)
      expect((await refused.json()).error.message).toBe("Too many open sessions")
      expect(small.sessions()).toBe(2)
    } finally {
      await small.close()
    }
  })

  test("idle sessions close; at a user's own limit their longest-idle session makes room", async () => {
    const small = await start({ maxSessionsPerUser: 2, idleMs: 300 })
    try {
      for (let i = 0; i < 3; i++) expect((await post(INIT, proxied({ [TICKET_HEADER]: ticket() }), small)).status).toBe(200)
      expect(small.sessions()).toBe(2)
      await new Promise((done) => setTimeout(done, 600))
      expect(small.sessions()).toBe(0)
    } finally {
      await small.close()
    }
  })

  test("a session holding a GET stream is active: the idle timer does not close it, and a user with only such sessions gets 429", async () => {
    const small = await start({ maxSessionsPerUser: 1, idleMs: 200, maxStreamMs: 5000 })
    try {
      const opened = await post(INIT, proxied({ [TICKET_HEADER]: ticket() }), small)
      const session = opened.headers.get("mcp-session-id") as string
      const headers = proxied({ [TICKET_HEADER]: ticket(), "mcp-session-id": session, "mcp-protocol-version": "2025-03-26" })
      await post({ jsonrpc: "2.0", method: "notifications/initialized" }, headers, small)
      const controller = new AbortController()
      const stream = await fetch(small.url, { headers: { ...headers, accept: "text/event-stream" }, signal: controller.signal })
      expect(stream.status).toBe(200)
      await new Promise((done) => setTimeout(done, 500))
      expect(small.sessions()).toBe(1)
      const refused = await post(INIT, proxied({ [TICKET_HEADER]: ticket() }), small)
      expect(refused.status).toBe(429)
      expect((await refused.json()).error.message).toBe("Too many open sessions for this user")
      controller.abort()
      await new Promise((done) => setTimeout(done, 500))
      expect(small.sessions()).toBe(0)
    } finally {
      await small.close()
    }
  }, 10_000)

  test("a session belongs to the user whose ticket opened it", async () => {
    const opened = await post(INIT, proxied({ [TICKET_HEADER]: ticket({ u: "alice" }) }))
    const session = opened.headers.get("mcp-session-id") as string
    expect(session).toMatch(/[\w-]{20,}/)
    const list = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }
    const base = { "mcp-session-id": session, "mcp-protocol-version": "2025-03-26" }
    const other = await post(list, proxied({ ...base, [TICKET_HEADER]: ticket({ u: "mallory" }) }))
    expect(other.status).toBe(403)
    expect((await other.json()).error.message).toBe("The session belongs to another user")
    expect((await post(list, proxied({ ...base, [TICKET_HEADER]: ticket({ u: "alice" }) }))).status).toBe(200)
  })

  test("a GET stream ends at its ticket's expiry or the cap", async () => {
    const capped = await start({ maxStreamMs: 300 })
    try {
      const opened = await post(INIT, proxied({ [TICKET_HEADER]: ticket() }), capped)
      const session = opened.headers.get("mcp-session-id") as string
      await post({ jsonrpc: "2.0", method: "notifications/initialized" }, proxied({ [TICKET_HEADER]: ticket(), "mcp-session-id": session, "mcp-protocol-version": "2025-03-26" }), capped)
      const { port } = new URL(capped.url)
      const started = Date.now()
      const status = await new Promise<number>((done, fail) => {
        const headers = proxied({ [TICKET_HEADER]: ticket(), "mcp-session-id": session, "mcp-protocol-version": "2025-03-26", accept: "text/event-stream" })
        const req = request({ host: "127.0.0.1", port, path: "/mcp", method: "GET", headers }, (res) => {
          res.resume()
          res.on("end", () => done(res.statusCode ?? 0))
        })
        req.on("error", fail)
        req.end()
      })
      expect(status).toBe(200)
      expect(Date.now() - started).toBeLessThan(3000)
    } finally {
      await capped.close()
    }
  }, 10_000)

  test("refuses to start without tickets unless explicitly local on a loopback address", async () => {
    const makeServer = () => createCopperflowServer(roots[1] as string, { engine: inProcessEngine })
    await expect(startMcpHttp({ port: 0, makeServer })).rejects.toThrow("needs the hub's ticket key")
    await expect(startMcpHttp({ port: 0, bind: "0.0.0.0", makeServer, insecureLocal: true })).rejects.toThrow("only listen on a loopback address")
    await expect(startMcpHttp({ port: 0, makeServer, ticket: { publicKey: KEYS.publicKey, workspaceId: "w" } })).rejects.toThrow("needs the public origin")
    const local = await startMcpHttp({ port: 0, makeServer, insecureLocal: true })
    try {
      const client = new Client({ name: "t", version: "0" })
      await client.connect(new StreamableHTTPClientTransport(new URL(local.url)))
      expect((await call(client, "list_circuits")).text).toBe(FILE)
      await client.close()
    } finally {
      await local.close()
    }
  })
})
