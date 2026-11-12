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
import { buildDesign } from "../src/engine/design.js"

const DEMO = join(import.meta.dirname, "..", "examples", "usb-c-ldo")
const FILE = "index.circuit.tsx"
/**
 * What a client pays to connect, at most: the instructions with the full tools/list result as JSON (41 895 on
 * 2026-11-12; the target of 38 000 is not met, see docs/plans/hosted-1.md)…
 */
const INSTRUCTIONS_AND_TOOLS_BUDGET = 42_000
/** …and the first guide answer (SKILL.md). */
const GUIDE_BUDGET = 16_000

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

  test("the hosted server offers no importer, and the tool list carries no schema plumbing", async () => {
    const hosted = await memoryClient(await demoCopy(), { hosted: true })
    const names = (await hosted.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain("import_part")
    expect(names).toContain("create_part")
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("import_part")
    const json = JSON.stringify(await hosted.listTools())
    for (const plumbing of ['"$schema"', '"pattern"', '"maxLength"', "9007199254740991", '"taskSupport"']) expect(json).not.toContain(plumbing)
    expect(json).toContain('"destructiveHint":true')
    const refused = await call(hosted, "import_part", { lcsc: "C7950" })
    expect(refused.isError).toBe(true)
  })

  test("hosted autoplace fits the board through the engine's worker build, never an in-process one", async () => {
    const calls: string[] = []
    const engine = {
      build: inProcessEngine.build,
      buildFiles: async (files: Record<string, string>, main: string) => {
        calls.push(main)
        return buildDesign(files, main)
      },
    }
    const hosted = await memoryClient(await demoCopy(), { hosted: true, engine })
    const answer = await call(hosted, "autoplace", { file: FILE, fit: true })
    expect(answer.isError, answer.text).toBe(false)
    expect(calls).toEqual([FILE])
    const local = await memoryClient(await demoCopy(), { engine })
    await call(local, "autoplace", { file: FILE, fit: true })
    expect(calls).toEqual([FILE])
  })

  test("what a hosted client pays to connect: the instructions, tools/list as JSON and the first guide answer", async () => {
    const hosted = await memoryClient(await demoCopy(), { hosted: true })
    const instructions = hosted.getInstructions() ?? ""
    expect(instructions).toContain("call guide")
    const toolList = JSON.stringify(await hosted.listTools())
    const first = (await call(hosted, "guide")).text
    expect(instructions.length + toolList.length).toBeLessThanOrEqual(INSTRUCTIONS_AND_TOOLS_BUDGET)
    expect(first.length).toBeLessThanOrEqual(GUIDE_BUDGET)
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
