import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { buildBom, formatBomMarkdown } from "../src/core/bom.js"
import { formatOrderReport } from "../src/core/order-report.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import type { Studio } from "../src/studio/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { startReachableStudio, retryLostConnect } from "./helpers/reachable-studio.js"

const FILE = "can-node.circuit.tsx"
let root: string
let report: string
let short: string
let table: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "cf-order-all-")))
  await cp(join(import.meta.dirname, "..", "examples", "can-node"), root, { recursive: true })
  const design = await inProcessEngine.build(root, FILE)
  const lines = await buildBom(root, FILE, { design })
  report = formatOrderReport(design, lines)
  short = formatOrderReport(design, lines, { short: true })
  table = formatBomMarkdown(lines)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function mcp(name: string, args: Record<string, unknown>): Promise<string> {
  const server = createCopperflowServer(root, { engine: inProcessEngine })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  const result = await client.callTool({ name, arguments: args })
  await client.close()
  return (result.content as Array<{ text: string }>).map((c) => c.text).join("\n")
}

async function cli(...args: string[]): Promise<string> {
  const out: string[] = []
  await runCli(args, root, { out: (s) => out.push(s), err: (s) => out.push(s) }, { engine: inProcessEngine })
  return out.join("\n")
}

describe("the order report is the same text everywhere", () => {
  test("circuit_summary { view: \"bom\" } and copperflow bom print it after the table; --csv stays a plain CSV", async () => {
    expect(await mcp("circuit_summary", { file: FILE, view: "bom" })).toBe(`${table}\n${report}`)
    expect(await cli("bom", FILE)).toBe(`${table}\n${report}`)
    expect(await cli("bom", FILE, "--csv")).not.toContain("Ready for")
  })

  test("export { as: \"fabrication\" } and copperflow export end with the short form", async () => {
    expect((await mcp("export", { file: FILE, as: "fabrication" })).endsWith(`\n${short}`)).toBe(true)
    expect((await cli("export", FILE)).endsWith(`\n${short}`)).toBe(true)
  })

  test("a refused export ends with the short form too", async () => {
    await writeFile(join(root, "bad.circuit.tsx"), 'export default () => (\n  <board width="10mm" height="10mm">\n    <resistor name="R1" resistance="1k" footprint="bogus9" pcbX={0} pcbY={0} />\n  </board>\n)\n')
    const text = await mcp("export", { file: "bad.circuit.tsx", as: "fabrication" })
    expect(text).toMatch(/^Refused/)
    expect(text).toMatch(/\nReady for bare boards: no: [^\n]+\nReady for assembly: [^\n]+\nThe whole order report: circuit_summary's bom view, or copperflow bom bad\.circuit\.tsx\.$/)
  })

  test("export { as: \"package\" } writes it into README.md", async () => {
    await mcp("export", { file: FILE, as: "package" })
    expect(await readFile(join(root, "exports", "can-node", "README.md"), "utf8")).toContain(`\n## Ready to order?\n\n${report}\n`)
  })

  test("the Studio's BOM endpoint answers the lines and the report", async () => {
    const staticDir = join(root, "static")
    await mkdir(staticDir)
    await writeFile(join(staticDir, "index.html"), "<html><head><title>x</title></head><body>studio</body></html>")
    const studio: Studio = await startReachableStudio({ root, staticDir, builder: inProcessEngine, maxStreams: 2 })
    try {
      const response = await retryLostConnect(() => fetch(`${studio.url}/api/bom?file=${FILE}`, { headers: { "x-copperflow-token": studio.token } }))
      const body = (await response.json()) as { ok: boolean; data: { lines: unknown[]; report: string } }
      expect(body.data.report).toBe(report)
      expect(body.data.lines.length).toBe(11)
    } finally {
      await studio.close()
    }
  })
})
