import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { expect, test } from "vitest"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

/** Every place in a schema where `items` is a list (the old way to write a pair), as a path. */
function listItems(node: unknown, path: string, found: string[] = []): string[] {
  if (Array.isArray(node)) node.forEach((one, i) => listItems(one, `${path}[${i}]`, found))
  else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "items" && Array.isArray(value)) found.push(`${path}.items`)
      listItems(value, `${path}.${key}`, found)
    }
  }
  return found
}

// A client that reads tool schemas as JSON Schema 2020-12 drops a tool whose `items` is a list, without a word: the
// agent then finds "No such tool available". create_part was lost this way (its points were pairs written as lists).
test("no tool's input schema writes items as a list", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-schema-"))
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  const { tools } = await client.listTools()
  expect(tools.length).toBeGreaterThan(30)
  expect(tools.flatMap((tool) => listItems(tool.inputSchema, tool.name))).toEqual([])
})

/** The tool list the client receives, from a fresh in-process server. */
async function listedTools() {
  const root = await mkdtemp(join(tmpdir(), "cf-size-"))
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return (await client.listTools()).tools
}

// Every client pays for the whole tool list on every turn: worked detail belongs in the guide.
test("the tool list stays at 31,000 characters or less", async () => {
  const tools = await listedTools()
  const total = JSON.stringify(tools).length
  const sizes = tools.map((tool) => `${tool.name} ${JSON.stringify(tool).length}`).sort().join(", ")
  expect(total, `tool list is ${total} characters: ${sizes}`).toBeLessThanOrEqual(31_000)
})

test("every tool's description is at most 700 characters", async () => {
  const tools = await listedTools()
  const long = tools.filter((tool) => (tool.description ?? "").length > 700).map((tool) => `${tool.name} ${tool.description?.length}`)
  expect(long, `descriptions over 700 characters: ${long.join(", ")}`).toEqual([])
})
