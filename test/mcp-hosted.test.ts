import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer, type ServerOptions } from "../src/mcp/server.js"
import { startMcpHttp, type McpHttp } from "../src/hosted/mcp-http.js"
import { signTicket, TICKET_HEADER } from "../src/hosted/ticket.js"
import { GUIDE_TOPICS } from "../src/mcp/guide.js"
import { createPartArgs, LDO } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const DEMO = join(import.meta.dirname, "..", "examples", "usb-c-ldo")
const KEY = Buffer.from("m".repeat(48))
const FILE = "index.circuit.tsx"
/** What connecting costs, at most: the instructions, the tool list and the first guide call. */
const CONNECT_BUDGET = 30_000

async function demoCopy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cf-mcp-hosted-"))
  await cp(DEMO, root, { recursive: true })
  return root
}

async function memoryClient(root: string, options: ServerOptions = {}): Promise<Client> {
  const server = createCopperflowServer(root, { engine: inProcessEngine, ...options })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

const ticket = (w = "ws-1") => signTicket({ w, u: "u", exp: Math.floor(Date.now() / 1000) + 300 }, KEY)

describe("MCP over HTTP", () => {
  let http: McpHttp
  let roots: string[]
  beforeEach(async () => {
    roots = [await demoCopy(), await demoCopy()]
    const httpRoot = roots[1] as string
    http = await startMcpHttp({ port: 0, makeServer: () => createCopperflowServer(httpRoot, { engine: inProcessEngine, hosted: true }), ticket: { key: KEY, workspaceId: "ws-1" } })
  })
  afterEach(() => http.close())

  async function httpClient(headers: Record<string, string>): Promise<Client> {
    const client = new Client({ name: "test", version: "0.0.0" })
    await client.connect(new StreamableHTTPClientTransport(new URL(http.url), { requestInit: { headers } }))
    return client
  }

  test("answers circuit_summary, check_circuit and new_circuit as the local server does on the demo project", async () => {
    const local = await memoryClient(roots[0] as string)
    const remote = await httpClient({ [TICKET_HEADER]: ticket() })
    try {
      for (const [name, args] of [
        ["circuit_summary", { file: FILE }],
        ["check_circuit", { file: FILE }],
        ["new_circuit", {
            file: "second.circuit.tsx",
            board: { width: 40, height: 30 },
            parts: [
              { name: "R1", kind: "resistor", value: "10k", footprint: "0402" },
              { name: "R2", kind: "resistor", value: "1k", footprint: "0402" },
            ],
            nets: { MID: ["R1.pin2", "R2.pin1"], GND: ["R2.pin2"] },
          }],
        ["list_circuits", {}],
      ] as const) {
        const a = await call(local, name, args)
        const b = await call(remote, name, args)
        expect(b, name).toEqual(a)
        expect(a.isError, a.text).toBe(false)
      }
      expect(await readFile(join(roots[1] as string, "second.circuit.tsx"), "utf8")).toBe(await readFile(join(roots[0] as string, "second.circuit.tsx"), "utf8"))
    } finally {
      await remote.close()
      await local.close()
    }
  })

  test("refuses a connection without a ticket or with another workspace's", async () => {
    const choices: Array<Record<string, string>> = [{}, { [TICKET_HEADER]: ticket("ws-2") }]
    for (const headers of choices) {
      const response = await fetch(http.url, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x", version: "1" } } }),
      })
      expect(response.status).toBe(403)
      const text = await response.text()
      expect(text).toMatch(/Missing workspace ticket|another workspace/)
      expect(text).not.toContain(KEY.toString())
    }
  })
})

describe("guide", () => {
  let client: Client
  beforeEach(async () => {
    client = await memoryClient(await demoCopy())
  })

  test("returns SKILL.md, each reference by name, and the names for an unknown topic", async () => {
    const skill = await call(client, "guide")
    expect(skill.text).toBe(await readFile(join(import.meta.dirname, "..", "skills", "copperflow", "SKILL.md"), "utf8"))
    for (const [topic, file] of Object.entries(GUIDE_TOPICS)) {
      expect((await call(client, "guide", { topic })).text).toBe(await readFile(join(import.meta.dirname, "..", "skills", "copperflow", file), "utf8"))
    }
    for (const topic of ["nope", "../../package.json", "references/copper.md", "__proto__", "constructor"]) {
      const answer = await call(client, "guide", { topic })
      expect(answer.isError, topic).toBe(true)
      expect(answer.text).toContain("Topics: design-workflow, copper, writing-circuits, parts-library, design-rules, editable-subset")
      expect(answer.text).not.toContain('"name": "copperflow"')
    }
  })

  test("offers every skill file as a resource", async () => {
    const { resources } = await client.listResources()
    expect(resources.map((r) => r.uri).sort()).toEqual(["copperflow://skill/SKILL.md", ...Object.values(GUIDE_TOPICS).map((f) => `copperflow://skill/${f}`)].sort())
    const read = await client.readResource({ uri: "copperflow://skill/SKILL.md" })
    expect((read.contents[0] as { text: string }).text).toContain("copperflow")
  })

  test("connecting costs less than 30 000 characters: instructions, tool list and the first guide call", async () => {
    const instructions = client.getInstructions() ?? ""
    expect(instructions).toContain("call guide")
    const list = (await client.listTools()).tools
    // Measured as the AI co-design proof measured it: each tool's name and description (16 161 with the instructions).
    const tools = list.reduce((n, t) => n + t.name.length + (t.description?.length ?? 0), 0)
    const schemas = list.reduce((n, t) => n + JSON.stringify(t.inputSchema).length, 0)
    const first = (await call(client, "guide")).text
    const cost = instructions.length + tools + first.length
    // 2026-11-12: 29 868 (instructions 907, tools 13 571, guide 15 390); the input schemas as JSON add 32 568 more.
    expect(cost).toBeLessThan(CONNECT_BUDGET)
    expect(schemas).toBeGreaterThan(0)
  })
})

describe("datasheets", () => {
  const CHIP = { ...LDO, datasheet: undefined } as typeof LDO

  test("attach_datasheet records the link and pages in part.yaml and the checklist, keeping the part unverified", async () => {
    const root = await demoCopy()
    const client = await memoryClient(root)
    expect((await call(client, "create_part", createPartArgs("LDO-X", CHIP))).isError).toBe(false)
    const answer = await call(client, "attach_datasheet", { part: "LDO-X", url: "https://www.diodes.com/assets/Datasheets/AP2112.pdf", title: "AP2112 datasheet rev 2", pages: "3" })
    expect(answer.isError).toBe(false)
    const yaml = await readFile(join(root, "parts", "LDO-X", "part.yaml"), "utf8")
    expect(yaml).toContain("url: https://www.diodes.com/assets/Datasheets/AP2112.pdf")
    expect(yaml).toContain("title: AP2112 datasheet rev 2")
    expect(yaml).toContain('datasheet_pages: "3"')
    const checklist = await readFile(join(root, "parts", "LDO-X", "verification.md"), "utf8")
    expect(checklist).toContain("- [ ] Pins from AP2112 datasheet rev 2, page(s) 3: compare each pin")
    expect(checklist).toContain("Status: not verified")
    expect(answer.text).toContain("Pins from AP2112 datasheet rev 2, page(s) 3: compare each pin")
  })

  test("attach_datasheet takes only http(s) links and never a missing part", async () => {
    const root = await demoCopy()
    const client = await memoryClient(root)
    await call(client, "create_part", createPartArgs("LDO-X", CHIP))
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "not a url"]) {
      const answer = await call(client, "attach_datasheet", { part: "LDO-X", url })
      expect(answer.isError, url).toBe(true)
      expect(answer.text).toContain("http(s)")
    }
    expect((await call(client, "attach_datasheet", { part: "nothing", url: "https://x.example/a.pdf" })).isError).toBe(true)
  })

  test("hosted create_part refuses a chip without a datasheet link unless its description says so; locally unchanged", async () => {
    const hosted = await memoryClient(await demoCopy(), { hosted: true })
    const refused = await call(hosted, "create_part", createPartArgs("LDO-X", CHIP))
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain('write "Pins NOT from a datasheet" in the description')
    expect((await call(hosted, "create_part", createPartArgs("LDO-X", LDO))).isError).toBe(false)
    const honest = { ...CHIP, description: "Pins NOT from a datasheet: copied from the board's silkscreen" }
    expect((await call(hosted, "create_part", createPartArgs("Other-1", honest))).isError).toBe(false)
    const small = { ...CHIP, footprint: "0402", pins: { "1": { name: "A", type: "passive" as const }, "2": { name: "B", type: "passive" as const } } }
    expect((await call(hosted, "create_part", createPartArgs("Small-1", small))).isError).toBe(false)
    const local = await memoryClient(await demoCopy())
    expect((await call(local, "create_part", createPartArgs("LDO-X", CHIP))).isError).toBe(false)
  })
})
