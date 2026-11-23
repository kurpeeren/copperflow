import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { listEntries } from "../src/core/index.js"
import { pointInPolygon } from "../src/engine/checks/geometry.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "index.circuit.tsx"
const EXAMPLE = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
const FIXTURES = fileURLToPath(new URL("./fixtures/dxf", import.meta.url))
let root: string
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

const entries = async () => (await listEntries(root, 100)).length
const source = () => readFile(join(root, FILE), "utf8")

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-mcp-board-"))
  await cp(EXAMPLE, root, { recursive: true })
  await cp(FIXTURES, join(root, "drawings"), { recursive: true })
  const server = createCopperflowServer(root, { engine: inProcessEngine })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

describe("fit_board with drawing", () => {
  test("is listed with its arguments", async () => {
    const { tools } = await client.listTools()
    expect(tools.find((t) => t.name === "import_board")).toBeUndefined()
    const tool = tools.find((t) => t.name === "fit_board")
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toEqual(expect.arrayContaining(["file", "drawing", "dxfLayer", "units", "origin", "replace"]))
    expect(tool?.inputSchema.required).toEqual(["file"])
  })

  test("writes the board as one change, answers in lines, and undo_change takes it back", async () => {
    const old = await source()
    const before = await entries()
    const result = await call("fit_board", { file: FILE, drawing: "drawings/rectangle-holes.dxf" })
    expect(result.isError).toBe(false)
    expect(result.text).toMatch(/^Change c\d+: board outline from rectangle-holes\.dxf: 4 corners, 82 x 54 mm \(drawing in mm, moved by -41, -27\)\n4 holes: 3\.2 mm at \(-37, -23\), \(37, -23\), \(37, 23\), \(-37, 23\)$/)
    expect(await entries()).toBe(before + 1)
    expect((await call("undo_change")).isError).toBe(false)
    expect(await source()).toBe(old)
  })

  test("replace, units and the not-used line", async () => {
    await call("fit_board", { file: FILE, drawing: "drawings/rectangle-holes.dxf" })
    const refused = await call("fit_board", { file: FILE, drawing: "drawings/rounded-inch.dxf" })
    expect(refused).toEqual({ isError: true, text: "fit_board { drawing } was refused: The board already has 4 holes; pass replace: true to replace them. Nothing was written." })
    const replaced = await call("fit_board", { file: FILE, drawing: "drawings/spline-open.dxf", replace: true, units: "mm" })
    expect(replaced.text.split("\n")).toEqual([
      expect.stringMatching(/^Change c\d+: board outline from spline-open\.dxf: 4 corners, 50 x 30 mm \(drawing read in mm as asked, moved by -25, -15\)$/),
      "Replaced the board's 4 holes.",
      "Not used: 2 SPLINE, 1 open chain of 3 lines",
    ])
  })

  test("refuses a drawing outside the project, writing nothing", async () => {
    const before = await source()
    const result = await call("fit_board", { file: FILE, drawing: "../enclosure.dxf" })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/^fit_board \{ drawing \} was refused: \.\.\/enclosure\.dxf is outside the project root\. Nothing was written\.$/)
    expect(await source()).toBe(before)
  })

  test("reads a KiCad board too: a new circuit with its copper and parts, as one change the agent can undo", async () => {
    await cp(fileURLToPath(new URL("./fixtures/kicad/fixture.kicad_pcb", import.meta.url)), join(root, "drawings", "fixture.kicad_pcb"))
    const before = await entries()
    const result = await call("fit_board", { file: "kicad.circuit.tsx", drawing: "drawings/fixture.kicad_pcb" })
    expect(result.isError).toBe(false)
    expect(result.text.split("\n")[0]).toMatch(/^Change c\d+: imported fixture\.kicad_pcb \(KiCad file version 20260206\) as kicad\.circuit\.tsx, its layout file and 4 new library parts$/)
    expect(result.text).toContain("Pads: all 49 copper pads have the net they had in the file")
    expect(await entries()).toBe(before + 1)
    const twice = await call("fit_board", { file: "kicad.circuit.tsx", drawing: "drawings/fixture.kicad_pcb" })
    expect(twice.text).toBe("fit_board { drawing } was refused: kicad.circuit.tsx already exists; pass replace: true to overwrite it, or choose another file. Nothing was written.")
    expect((await call("undo_change")).isError).toBe(false)
    expect(await readFile(join(root, "kicad.circuit.tsx"), "utf8").catch(() => "gone")).toBe("gone")
  })

  test("refuses a KiCad board outside the project, and layer or units with one", async () => {
    const outside = await call("fit_board", { file: "kicad.circuit.tsx", drawing: "../fixture.kicad_pcb" })
    expect(outside).toEqual({ isError: true, text: "fit_board { drawing } was refused: ../fixture.kicad_pcb is outside the project folder. Nothing was written." })
    const layer = await call("fit_board", { file: "kicad.circuit.tsx", drawing: "drawings/fixture.kicad_pcb", dxfLayer: "Edge.Cuts" })
    expect(layer).toEqual({ isError: true, text: "fit_board { drawing } was refused: dxfLayer and units are for a DXF drawing; a KiCad board's outline is its Edge.Cuts layer, in mm. Nothing was written." })
  })

  test("after an import the circuit builds, check_circuit runs and reports a part off the new outline", async () => {
    const result = await call("fit_board", { file: FILE, drawing: "drawings/inner-shape.dxf", dxfLayer: "Cutout" })
    expect(result.text).toMatch(/placed parts are now outside the outline: .*J1/)
    const summary = await call("circuit_summary", { file: FILE, view: "board" })
    expect(summary.isError).toBe(false)
    const check = await call("check_circuit", { file: FILE })
    expect(check.isError).toBe(false)
    expect(check.text).toMatch(/J1\S* is outside the board/)
  })
})

/** An L: 40 mm arms, 15 mm wide. */
const L_SHAPE = [
  "0", "SECTION", "2", "ENTITIES",
  "0", "LWPOLYLINE", "8", "Outline", "90", "6", "70", "1",
  "10", "0", "20", "0", "10", "40", "20", "0", "10", "40", "20", "15", "10", "15", "20", "15", "10", "15", "20", "40", "10", "0", "20", "40",
  "0", "ENDSEC", "0", "EOF", "",
].join("\n")

const L_CIRCUIT = `export default () => (
  <board width="40mm" height="40mm">
${Array.from({ length: 8 }, (_, i) => `    <resistor name="R${i + 1}" resistance="1k" footprint="0603" />`).join("\n")}
${Array.from({ length: 7 }, (_, i) => `    <trace from="R${i + 1}.pin2" to="R${i + 2}.pin1" />`).join("\n")}
  </board>
)
`

describe("autoplace on an L-shaped board", () => {
  test("puts no part outside the outline", async () => {
    await writeFile(join(root, "l.circuit.tsx"), L_CIRCUIT)
    await writeFile(join(root, "l.dxf"), L_SHAPE)
    const imported = await call("fit_board", { file: "l.circuit.tsx", drawing: "l.dxf" })
    expect(imported.isError).toBe(false)
    const placed = await call("autoplace", { file: "l.circuit.tsx", budgetSeconds: 3 })
    expect(placed.text).toMatch(/^Placed 8 parts/)
    const design = await inProcessEngine.build(root, "l.circuit.tsx")
    const outline = design.pcb.board?.outline ?? []
    expect(outline).toHaveLength(6)
    const outside = design.pcb.parts.filter((part) => part.pads.some((pad) => !pointInPolygon(pad, outline)) || part.courtyard.some((p) => !pointInPolygon(p, outline)))
    expect(outside.map((part) => part.component)).toEqual([])
  })
})
