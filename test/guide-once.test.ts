import { describe, expect, test } from "vitest"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createGuideMemory, GUIDE_MEMORY_LIMIT, guideInSession, guideInput } from "../src/mcp/guide.js"
import { createCopperflowServer } from "../src/mcp/server.js"

const SHORT_LINE = /already returned in this session.*again: true/

async function connected(): Promise<Client> {
  const server = createCopperflowServer("/nowhere-copperflow-guide-test")
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return client
}

async function guideCall(client: Client, args: Record<string, unknown> = {}): Promise<{ text: string; isError: boolean }> {
  const result = await client.callTool({ name: "guide", arguments: args })
  return { text: (result.content as Array<{ text: string }>).map((c) => c.text).join("\n"), isError: result.isError === true }
}

describe("guide in one session", () => {
  test("the second call with the same arguments answers one short line, again: true gives the text again", async () => {
    const memory = createGuideMemory()
    const first = await guideInSession(memory, {})
    expect(first.length).toBeGreaterThan(5000)
    const second = await guideInSession(memory, {})
    expect(second).toMatch(SHORT_LINE)
    expect(second.length).toBeLessThan(300)
    expect(second.split("\n")).toHaveLength(1)
    expect(await guideInSession(memory, { again: true })).toBe(first)
    // "no topic" and an empty topic are the same arguments.
    expect(await guideInSession(memory, { topic: "" })).toMatch(SHORT_LINE)
  })

  test("another topic is another arguments; the same topic twice is answered short and names the topic", async () => {
    const memory = createGuideMemory()
    const copper = await guideInSession(memory, { topic: "copper" })
    expect(copper).not.toMatch(SHORT_LINE)
    expect(await guideInSession(memory, {})).not.toMatch(SHORT_LINE)
    const again = await guideInSession(memory, { topic: "copper" })
    expect(again).toMatch(SHORT_LINE)
    expect(again).toContain('"copper"')
    expect(await guideInSession(memory, { topic: "copper", again: false })).toMatch(SHORT_LINE)
    expect(await guideInSession(memory, { topic: "copper", again: true })).toBe(copper)
  })

  test("a topic that does not exist is refused every time and is not remembered", async () => {
    const memory = createGuideMemory()
    await expect(guideInSession(memory, { topic: "nope" })).rejects.toThrow(/No guide topic "nope"/)
    await expect(guideInSession(memory, { topic: "nope" })).rejects.toThrow(/No guide topic "nope"/)
  })

  test("at most 32 argument sets are remembered: the oldest is forgotten first", async () => {
    expect(GUIDE_MEMORY_LIMIT).toBe(32)
    const memory = createGuideMemory()
    await guideInSession(memory, { topic: "copper" })
    // Only valid topics are remembered, so fill the memory through its own interface.
    for (let i = 0; i < GUIDE_MEMORY_LIMIT; i += 1) memory.remember(`filler ${i}`)
    expect(memory.size).toBe(GUIDE_MEMORY_LIMIT)
    expect(await guideInSession(memory, { topic: "copper" })).not.toMatch(SHORT_LINE)
  })

  test("the tool states again, and each MCP session has its own memory", async () => {
    const one = await connected()
    const two = await connected()
    const { tools } = await one.listTools()
    const properties = tools.find((t) => t.name === "guide")?.inputSchema.properties ?? {}
    expect(Object.keys(properties)).toEqual(["topic", "again"])
    expect(Object.keys(guideInput)).toEqual(["topic", "again"])
    const first = await guideCall(one)
    expect(first.text.length).toBeGreaterThan(5000)
    expect((await guideCall(one)).text).toMatch(SHORT_LINE)
    expect((await guideCall(two)).text).toBe(first.text)
    expect((await guideCall(one, { again: true })).text).toBe(first.text)
    expect((await guideCall(one, { topic: "nope" })).isError).toBe(true)
  })
})
