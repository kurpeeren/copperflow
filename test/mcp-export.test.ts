import { cp, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createCopperflowServer } from "../src/mcp/server.js"
import { BOARD, SHARED } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const CAN = join(import.meta.dirname, "fixtures", "can-module")
const CLEAN = `export default () => (
  <board width="10mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" supplierPartNumbers={{ jlcpcb: ["C11702"] }} pcbX={0} pcbY={0} schX={0} schY={0} />
  </board>
)
`
let root: string
let client: Client

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-mcp-export-"))
  const server = createCopperflowServer(root, { engine: inProcessEngine })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

afterEach(async () => {
  await client.close()
  await rm(root, { recursive: true, force: true })
})

async function call(args: Record<string, unknown>) {
  const result = await client.callTool({ name: "export_fabrication", arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

const exists = (path: string) => stat(join(root, path)).then(
  () => true,
  () => false,
)

describe("export_fabrication", () => {
  test("takes the circuit file and an optional project folder, and says it writes files", async () => {
    const { tools } = await client.listTools()
    const tool = tools.find((t) => t.name === "export_fabrication")
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(["file", "out"])
    expect(tool?.inputSchema.required).toEqual(["file"])
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    expect(tool?.description).toMatch(/JLCPCB/)
  })

  test("answers compactly: the folder and zip, the files on one line, and that a person uploads the zip", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CLEAN)
    const answer = await call({ file: "led.circuit.tsx" })
    expect(answer.isError).toBe(false)
    const files = ["F_Cu.gtl", "B_Cu.gbl", "F_Mask.gts", "B_Mask.gbs", "F_Paste.gtp", "B_Paste.gbp", "F_Silkscreen.gto", "B_Silkscreen.gbo", "Edge_Cuts.gm1", "PTH.drl", "NPTH.drl", "pick-and-place.csv", "bom.csv"]
    expect(answer.text).toBe(
      ["Wrote 13 files to led-fab/ and led-fab.zip:", files.map((name) => `led-${name}`).join(", "), "Checks: 0 errors, 2 warnings.", "Next, a person should upload led-fab.zip to JLCPCB's PCB order, and led-bom.csv and led-pick-and-place.csv from led-fab/ at its assembly step (the zip holds them too).", "Ready for bare boards: yes", "Ready for assembly: yes", "The whole order report: the bom tool, or copperflow bom led.circuit.tsx."].join("\n"),
    )
    expect(await readdir(join(root, "led-fab"))).toHaveLength(13)
    expect((await readFile(join(root, "led-fab.zip"))).subarray(0, 4).toString("hex")).toBe("504b0304")
  })

  test("out puts them in another project folder; a folder outside the project is a tool error", async () => {
    await writeFile(join(root, "led.circuit.tsx"), CLEAN)
    expect((await call({ file: "led.circuit.tsx", out: "fab" })).text).toMatch(/^Wrote 13 files to fab\/led-fab\/ and fab\/led-fab\.zip:/)
    expect(await exists("fab/led-fab.zip")).toBe(true)
    const outside = await call({ file: "led.circuit.tsx", out: "../x" })
    expect(outside).toMatchObject({ isError: true, text: expect.stringMatching(/outside the project root/) })
  })

  test("lists the warnings, such as unrouted connections", async () => {
    await cp(CAN, root, { recursive: true })
    const answer = await call({ file: "can-module.circuit.tsx" })
    expect(answer.isError).toBe(false)
    expect(answer.text).toMatch(/\nWarning: \d+ connections are not routed: net\.\w+: /)
  })

  test("a design with errors is refused as a tool error naming each one, and nothing is written", async () => {
    await writeFile(join(root, "main.circuit.tsx"), BOARD)
    await writeFile(join(root, "shared.ts"), SHARED)
    const answer = await call({ file: "main.circuit.tsx" })
    expect(answer.isError).toBe(true)
    expect(answer.text).toMatch(/^Refused: no fabrication files were written\. Fix these errors first:\n {2}duplicate-name: /)
    expect(await exists("main-fab.zip")).toBe(false)
  })

  test("the skill says to export after autoroute and a clean check_circuit, and that a person uploads the zip", async () => {
    const skill = await readFile(new URL("../skills/copperflow/SKILL.md", import.meta.url), "utf8")
    expect(skill).toMatch(/after `autoroute` and a clean `check_circuit` \(0 errors\s+and no `unrouted` warning\), call `export_fabrication`/)
    expect(skill).toMatch(/An export with unrouted connections is written with a warning and is NOT a finished\s+board/)
    expect(skill).toMatch(/A person uploads the\s+zip to JLCPCB/)
  })
})
