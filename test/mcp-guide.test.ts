import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer, type ServerOptions } from "../src/mcp/server.js"
import { GUIDE_TOPICS } from "../src/mcp/guide.js"
import { createPartArgs, LDO } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const DEMO = join(import.meta.dirname, "..", "examples", "usb-c-ldo")

async function demoCopy(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cf-mcp-guide-"))
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

describe("guide", () => {
  let client: Client
  beforeEach(async () => {
    client = await memoryClient(await demoCopy())
  })

  test("returns SKILL.md, each reference by name, and the names for an unknown topic", async () => {
    const skill = await call(client, "guide")
    // SKILL.md less its frontmatter block.
    const skillFile = await readFile(join(import.meta.dirname, "..", "skills", "copperflow", "SKILL.md"), "utf8")
    expect(skill.text).toBe(skillFile.slice(skillFile.indexOf("\n---\n", 4) + "\n---\n".length).replace(/^\n+/, ""))
    for (const [topic, file] of Object.entries(GUIDE_TOPICS)) {
      expect((await call(client, "guide", { topic })).text).toBe(await readFile(join(import.meta.dirname, "..", "skills", "copperflow", file), "utf8"))
    }
    for (const topic of ["nope", "../../package.json", "references/copper.md", "__proto__", "constructor"]) {
      const answer = await call(client, "guide", { topic })
      expect(answer.isError, topic).toBe(true)
      expect(answer.text).toContain("Topics: planning, design-workflow, copper, writing-circuits, parts-library, design-rules, editable-subset")
      expect(answer.text).not.toContain('"name": "copperflow"')
    }
  })

  test("offers every skill file as a resource", async () => {
    const { resources } = await client.listResources()
    expect(resources.map((r) => r.uri).sort()).toEqual(["copperflow://skill/SKILL.md", ...Object.values(GUIDE_TOPICS).map((f) => `copperflow://skill/${f}`)].sort())
    const read = await client.readResource({ uri: "copperflow://skill/SKILL.md" })
    expect((read.contents[0] as { text: string }).text).toContain("copperflow")
  })

  test("the server offers the importer, and the tool list carries no schema plumbing", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name)
    expect(names).toContain("import_part")
    expect(names).toContain("create_part")
    const json = JSON.stringify(await client.listTools())
    for (const plumbing of ['"$schema"', '"pattern"', '"maxLength"', "9007199254740991", '"taskSupport"']) expect(json).not.toContain(plumbing)
    expect(json).toContain('"destructiveHint":true')
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

  test("create_part takes a chip without a datasheet link", async () => {
    const local = await memoryClient(await demoCopy())
    expect((await call(local, "create_part", createPartArgs("LDO-X", CHIP))).isError).toBe(false)
  })
})
