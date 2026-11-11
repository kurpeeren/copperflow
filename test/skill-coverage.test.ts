import { beforeAll, describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { skillFiles } from "./helpers/skill-text.js"

const MAX_LINES = 200
let client: Client

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-skill-"))
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

const lineCount = (text: string) => text.replace(/\n$/, "").split("\n").length

describe("the copperflow skill", () => {
  test("names every tool the server registers", async () => {
    const text = Object.values(await skillFiles()).join("\n")
    const names = (await client.listTools()).tools.map((tool) => tool.name)
    expect(names.length).toBeGreaterThan(30)
    expect(names.filter((name) => !new RegExp(`\\b${name}\\b`).test(text))).toEqual([])
  })

  test("SKILL.md and the worked example are each under 200 lines", async () => {
    const files = await skillFiles()
    for (const path of ["SKILL.md", "references/design-workflow.md"]) {
      expect(files[path], path).toBeDefined()
      expect(lineCount(files[path] ?? ""), path).toBeLessThan(MAX_LINES)
    }
  })

  test("SKILL.md links every reference", async () => {
    const files = await skillFiles()
    for (const path of Object.keys(files).filter((p) => p.startsWith("references/"))) expect(files["SKILL.md"]).toContain(`(${path})`)
  })

  test("the instructions say to call project_status first and follow the skill", () => {
    const text = client.getInstructions() ?? ""
    expect(text).toMatch(/project_status first/)
    expect(text).toMatch(/copperflow skill/)
  })
})
