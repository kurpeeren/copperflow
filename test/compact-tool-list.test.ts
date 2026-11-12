import { describe, expect, test } from "vitest"
import { z } from "zod"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { compactSchema, compactToolList } from "../src/mcp/compact-tool-list.js"

async function connected(): Promise<Client> {
  const server = new McpServer({ name: "t", version: "0" })
  server.registerTool(
    "find",
    {
      description: "Find text.",
      inputSchema: {
        pattern: z.string().max(20).regex(/^[a-z]+$/).describe("What to look for"),
        format: z.enum(["short", "long"]),
        maxLength: z.number().int().max(100),
      },
    },
    ({ pattern }) => ({ content: [{ type: "text", text: `found ${pattern}` }] }),
  )
  compactToolList(server)
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "c", version: "0" })
  await Promise.all([server.connect(b), client.connect(a)])
  return client
}

describe("the compacted tool list", () => {
  test("keeps arguments named like keywords and drops only the keywords", async () => {
    const client = await connected()
    const [tool] = (await client.listTools()).tools
    const schema = tool?.inputSchema as { properties: Record<string, Record<string, unknown>>; required: string[] }
    expect(Object.keys(schema.properties)).toEqual(["pattern", "format", "maxLength"])
    expect(schema.required).toEqual(["pattern", "format", "maxLength"])
    expect(schema.properties.pattern).toEqual({ type: "string", description: "What to look for" })
    expect(schema.properties.format).toEqual({ type: "string", enum: ["short", "long"] })
    expect(schema.properties.maxLength).toEqual({ type: "integer", maximum: 100 })
  })

  test("a call that breaks a constraint the list no longer shows is still refused", async () => {
    const client = await connected()
    const good = await client.callTool({ name: "find", arguments: { pattern: "abc", format: "short", maxLength: 5 } })
    expect(good.isError).not.toBe(true)
    for (const args of [
      { pattern: "ABC", format: "short", maxLength: 5 },
      { pattern: "a".repeat(21), format: "short", maxLength: 5 },
      { pattern: "abc", format: "short", maxLength: 101 },
    ]) {
      const refused = await client.callTool({ name: "find", arguments: args })
      expect(refused.isError, JSON.stringify(args)).toBe(true)
      expect((refused.content as Array<{ text: string }>)[0]?.text).toContain("Input validation error")
    }
  })

  test("compactSchema leaves non-schema values alone", () => {
    expect(compactSchema({ type: "object", properties: { pattern: { type: "string", pattern: "^x$" } }, $schema: "x" })).toEqual({ type: "object", properties: { pattern: { type: "string" } } })
  })
})
