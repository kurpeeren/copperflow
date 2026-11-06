import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { loadCircuit, updateAnnotations } from "../src/core/workspace.js"
import { addMark, lockParts } from "../src/core/annotations.js"
import { checkCircuit, formatCheck } from "../src/core/check.js"
import { BOARD, LDO, SHARED, USBX, USBX_FOOTPRINT } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
let root: string
let client: Client

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-mcp-"))
  await writeFile(join(root, FILE), BOARD)
  await writeFile(join(root, "shared.ts"), SHARED)
  const server = createCopperflowServer(root, { engine: inProcessEngine })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

describe("MCP server", () => {
  test("exposes its tools, with no unlock or verify tool", async () => {
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_trace",
      "bom",
      "check_circuit",
      "circuit_summary",
      "create_part",
      "export_package",
      "list_circuits",
      "list_parts",
      "part_info",
      "place_part",
      "recent_changes",
      "remove_part",
      "remove_trace",
      "set_props",
      "undo_change",
    ])
  })

  test("create_part describes copperflow footprints without naming the old toolkit", async () => {
    const { tools } = await client.listTools()
    const description = tools.find((t) => t.name === "create_part")?.description ?? ""
    expect(description).toMatch(/sot23_5/)
    expect(description.toLowerCase()).not.toContain("tscircuit")
  })

  test("bom and export_package take no build input", async () => {
    const { tools } = await client.listTools()
    for (const name of ["bom", "export_package"]) {
      const properties = tools.find((t) => t.name === name)?.inputSchema.properties ?? {}
      expect(Object.keys(properties)).toEqual(["file"])
    }
  })

  test("the agent creates a part from a datasheet, places it and sees it in the BOM", async () => {
    const created = await call("create_part", { id: "AP2112K-3.3", part: LDO })
    expect(created.isError).toBe(false)
    expect(created.text).toContain("NOT verified")
    expect((await call("list_parts")).text).toContain("AP2112K-3.3  <AP2112K_3_3>  AP2112K-3.3 LDO regulator  sot23_5  NOT verified")
    expect((await call("part_info", { id: "AP2112K-3.3" })).text).toContain("mpn: AP2112K-3.3TRG1")
    const placed = await call("place_part", { file: FILE, part: "AP2112K-3.3", name: "U5", props: { pcbX: 3 } })
    expect(placed.text).toMatch(/Change c0001 applied: place U5/)
    expect(await readFile(join(root, FILE), "utf8")).toContain('<AP2112K_3_3 name="U5" pcbX={3} />')
    expect((await call("bom", { file: FILE })).text).toContain("| U5 | 1 | chip | AP2112K-3.3 LDO regulator | sot23_5 | Diodes Incorporated | AP2112K-3.3TRG1 | jlcpcb C51118 |")
  })

  test("create_part with footprint_file writes parts/<id>/footprint.yaml and lists it", async () => {
    const created = await call("create_part", { id: "USBX", part: USBX, footprint_file: USBX_FOOTPRINT })
    expect(created.isError).toBe(false)
    expect(created.text).toContain("parts/USBX/footprint.yaml")
    expect(await readFile(join(root, "parts", "USBX", "footprint.yaml"), "utf8")).toContain("pads:")
    const bad = { pads: [{ number: "9", shape: "rect", x: 0, y: 0, width: 1, height: 1 }] }
    const refused = await call("create_part", { id: "USBY", part: USBX, footprint_file: bad })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/pad 9/)
  })

  test("invalid parts come back as tool errors", async () => {
    const result = await call("create_part", { id: "../evil", part: LDO })
    expect(result.isError).toBe(true)
  })

  test("list_circuits and circuit_summary describe the project", async () => {
    expect((await call("list_circuits")).text).toContain(FILE)
    const { model } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (ann) =>
      addMark(lockParts(ann, model, ["C1"], "2026-11-03T10:00:00.000Z"), { text: "route GND here", view: "pcb", x: 1, y: 2 }, "2026-11-03T10:00:00.000Z").annotations,
    )
    const summary = (await call("circuit_summary", { file: FILE })).text
    expect(summary).toContain('R1 <resistor> resistance="5.1k" footprint="0402" pcbX={-4} pcbY={2}')
    expect(summary).toContain("C1 <capacitor> [LOCKED]")
    expect(summary).toContain("RX <resistor> [read-only: inside a callback such as .map()]")
    expect(summary).toContain("pcbX={offset + 2} (read-only)")
    expect(summary).toContain(".R1 > .pin1 -> net.GND")
    expect(summary).toContain("m1 (pcb 1, 2): route GND here")
    expect(summary).toContain("Lock violations: none")
  })

  test("set_props edits the file and returns the change id", async () => {
    const result = await call("set_props", { file: FILE, part: "R1", props: { pcbX: 2, pcbRotation: 90 } })
    expect(result.isError).toBe(false)
    expect(result.text).toMatch(/Change \S+ applied/)
    expect(await readFile(join(root, FILE), "utf8")).toContain("pcbX={2} pcbY={2} pcbRotation={90}")
  })

  test("edits of locked parts come back as tool errors", async () => {
    const { model } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (ann) => lockParts(ann, model, ["R1"], "2026-11-03T10:00:00.000Z"))
    const result = await call("remove_part", { file: FILE, part: "R1" })
    expect(result.isError).toBe(true)
    expect(result.text).toContain("R1 is locked")
  })

  test("traces, history and undo work end to end", async () => {
    expect((await call("add_trace", { file: FILE, from: ".LED1 > .pin1", to: "net.GND" })).isError).toBe(false)
    expect((await call("remove_trace", { file: FILE, from: ".R1 > .pin1", to: "net.GND" })).isError).toBe(false)
    expect((await call("recent_changes", { limit: 5 })).text).toContain("ai  remove trace .R1 > .pin1 -> net.GND")
    expect((await call("undo_change")).isError).toBe(false)
    expect((await call("undo_change")).isError).toBe(false)
    expect(await readFile(join(root, FILE), "utf8")).toBe(BOARD)
  })

  test("check_circuit returns the same text as formatCheck", async () => {
    const result = await call("check_circuit", { file: FILE })
    expect(result.isError).toBe(false)
    expect(result.text).toBe(formatCheck(FILE, await checkCircuit(root, FILE, { engine: inProcessEngine })))
    expect(result.text).toContain("check failed")
    expect(result.text).toContain("More than one part is named RX")
  })

  test("check_circuit says what it checks and does not name the old toolkit", async () => {
    const { tools } = await client.listTools()
    const description = tools.find((t) => t.name === "check_circuit")?.description ?? ""
    expect(description).toMatch(/connection|pin|placement/i)
    expect(description.toLowerCase()).not.toContain("tscircuit")
  })

  test("check_circuit only reads, so clients need not ask before it runs", async () => {
    const { tools } = await client.listTools()
    expect(tools.find((t) => t.name === "check_circuit")?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
  })

  test("the instructions say to check after every change and fix every error, as the tool description does", async () => {
    const instructions = client.getInstructions() ?? ""
    expect(instructions).toContain("After every change, call check_circuit and fix every error before reporting success.")
    expect(instructions).not.toMatch(/placement errors/)
  })

  test("paths outside the project are rejected", async () => {
    const result = await call("circuit_summary", { file: "../outside.circuit.tsx" })
    expect(result.isError).toBe(true)
    expect(result.text).toContain("outside the project")
  })
})
