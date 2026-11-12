import { afterEach, describe, expect, test } from "vitest"
import { createServer, type Server } from "node:http"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { HubServer } from "../src/hub/server.js"
import { fixedRunner, newUser, startTestHub } from "./helpers/hub-client.js"
import { call, connectAgent } from "./helpers/hub-mcp.js"

let server: HubServer | undefined
let workspace: Server | undefined
const clients: Client[] = []
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined)
  await server?.close()
  server = undefined
  workspace?.closeAllConnections()
  await new Promise<void>((done) => (workspace ? workspace.close(() => done()) : done()))
  workspace = undefined
})

/** A stand-in workspace MCP server (stateless): project_status answers after `slowMs`, list_circuits at once. */
async function fakeWorkspace(slowMs: number): Promise<{ origin: string; initialises: () => number }> {
  let initialises = 0
  workspace = createServer((req, res) => {
    let body = ""
    req.on("data", (chunk: Buffer) => (body += chunk.toString()))
    req.on("end", () => {
      const parsed = body === "" ? undefined : (JSON.parse(body) as { method?: string })
      if (parsed?.method === "initialize") initialises += 1
      const mcp = new McpServer({ name: "fake", version: "0" })
      mcp.registerTool("project_status", {}, async () => {
        await new Promise((done) => setTimeout(done, slowMs))
        return { content: [{ type: "text", text: "slow done" }] }
      })
      mcp.registerTool("list_circuits", {}, () => ({ content: [{ type: "text", text: "main.circuit.tsx" }] }))
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      res.on("close", () => void transport.close())
      void mcp.connect(transport).then(() => transport.handleRequest(req, res, parsed))
    })
  })
  await new Promise<void>((done) => workspace?.listen(0, "127.0.0.1", () => done()))
  const port = (workspace.address() as { port: number }).port
  return { origin: `http://127.0.0.1:${port}`, initialises: () => initialises }
}

async function agentWithProject(hub: HubServer): Promise<Client> {
  const ada = await newUser(hub, "ada@example.com")
  const made = await ada.submit("/account", "/account/tokens", { name: "a", password: "a good password" })
  const client = await connectAgent(hub, /cfp_[A-Za-z0-9_-]{43}/.exec(made.text)?.[0] as string)
  clients.push(client)
  await call(client, "new_project", { name: "Amp" })
  return client
}

describe("forwarded calls share one upstream connection", () => {
  test("cancelling one of two concurrent calls neither closes the connection nor fails the other", async () => {
    const fake = await fakeWorkspace(300)
    server = await startTestHub({ runner: () => fixedRunner(() => fake.origin) })
    const client = await agentWithProject(server)
    expect((await call(client, "list_circuits")).text).toBe("main.circuit.tsx")
    const cancel = new AbortController()
    const cancelled = client.callTool({ name: "project_status", arguments: {} }, undefined, { signal: cancel.signal })
    const other = client.callTool({ name: "project_status", arguments: {} })
    setTimeout(() => cancel.abort(), 50)
    await expect(cancelled).rejects.toThrow()
    const answer = (await other) as { content: Array<{ text: string }>; isError?: boolean }
    expect(answer.isError).toBeUndefined()
    expect(answer.content[0]?.text).toBe("slow done")
    expect((await call(client, "list_circuits")).text).toBe("main.circuit.tsx")
    expect(fake.initialises()).toBe(1)
  })
})
