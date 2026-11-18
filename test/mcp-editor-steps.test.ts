// The editor's edits through MCP: drawings and text, pages, a wire's corners, renaming designators, sheet ports and
// size, a pour's and a hole's props after they exist, and redo of the agent's own undo.
import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { recordEntry } from "../src/core/history.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
const CIRCUIT = `export default () => (
  <board width={30} height={20}>
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />
    <resistor name="R7" resistance="1k" footprint="0603" pcbX={5} pcbY={0} />
    <trace from=".R1 > .pin1" to="net.V5" />
    <trace from=".R7 > .pin1" to="net.V5" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R7 > .pin2" to="net.GND" />
    <copperpour net="GND" layer="bottom" />
    <hole x={10} y={5} diameter={3} />
  </board>
)
`
const SHEET = `export default () => (
  <sheet>
    <port name="VIN" />
    <resistor name="R1" resistance="1k" />
    <trace from=".R1 > .pin1" to="net.VIN" />
  </sheet>
)
`

let root: string
let client: Client

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-mcp-steps-"))
  await writeFile(join(root, FILE), CIRCUIT)
  await writeFile(join(root, "Stage.sheet.tsx"), SHEET)
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}
const edit = (edits: unknown[], file = FILE) => call("edit_circuit", { file, edits })
const source = (file = FILE) => readFile(join(root, file), "utf8")

describe("drawings and text", () => {
  test("add_text writes a note on a page in one call and names it", async () => {
    const result = await call("add_text", { file: FILE, text: "Rev A", x: 1, y: 2 })
    expect(result.isError, result.text).toBe(false)
    expect(result.text).toMatch(/^Change c0001 applied: add text G1 "Rev A"/)
    expect(await source()).toContain('<schematictext name="G1" text="Rev A" x={1} y={2} />')
  })

  test("add_drawing draws a shape on a named page, set_drawing moves it, remove_drawing removes it", async () => {
    const added = await edit([{ add_page: { name: "Notes" } }, { add_drawing: { shape: "rect", x: 0, y: 0, width: 3, height: 2, page: "Notes" } }, { add_drawing: { text: "box", x: 0, y: 3 } }])
    expect(added.isError, added.text).toBe(false)
    expect(added.text).toContain("add rect G1 on page Notes; add text G2")
    expect((await edit([{ set_drawing: { id: "G1", x: 4 } }])).text).toMatch(/Change c0002 applied: 1 edit: set G1 x/)
    expect(await source()).toMatch(/<schematicrect name="G1" x=\{4\}/)
    expect((await edit([{ remove_drawing: { id: "G1" } }])).isError).toBe(false)
    expect(await source()).not.toContain("schematicrect")
  })

  test("a wrong shape is answered with the right one, and nothing is written", async () => {
    const result = await edit([{ add_drawing: { shape: "rect", x: 0, y: 0 } }])
    expect(result.isError).toBe(true)
    expect(result.text).toContain("add_drawing width:")
    expect(result.text).toContain('It takes { shape?: "text" (default)')
    expect(await source()).toBe(CIRCUIT)
    expect((await edit([{ add_drawing: { shape: "star" } }])).text).toContain("shape must be one of text, line, rect")
    expect((await edit([{ remove_drawing: { id: "G9" } }])).text).toContain("No drawing with id G9")
  })
})

describe("pages", () => {
  test("adds, renames and removes a page", async () => {
    expect((await edit([{ add_page: { name: "Power" } }])).isError).toBe(false)
    expect((await edit([{ rename_page: { from: "Power", to: "Supply" } }])).text).toContain("rename page Power to Supply")
    expect(await source()).toContain('<page name="Supply"')
    expect((await edit([{ remove_page: { name: "Supply" } }])).isError).toBe(false)
    expect(await source()).not.toContain("<page")
  })

  test("refuses to remove a page with a part on it, saying why", async () => {
    await edit([{ move_to_page: { part: "R7", page: "Power" } }])
    const result = await edit([{ remove_page: { name: "Power" } }])
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/Edit 1 of 1 \(remove_page\) was refused/)
  })
})

describe("wire corners", () => {
  test("wire_corners sets and removes a wire's corners; connect takes corners", async () => {
    const set = await edit([{ wire_corners: { from: ".R1 > .pin1", to: "net.V5", corners: [{ x: 1, y: 1 }] } }])
    expect(set.isError, set.text).toBe(false)
    expect(set.text).toContain("1 corner")
    expect(await source()).toContain("schematicRouteHints={[{ x: 1, y: 1 }]}")
    expect((await edit([{ wire_corners: { from: ".R1 > .pin1", to: "net.V5", corners: [] } }])).text).toContain("straight")
    expect(await source()).not.toContain("schematicRouteHints")
    expect((await edit([{ connect: { from: ".R1 > .pin1", to: "net.EN", corners: [{ x: 2, y: 0 }] } }])).isError).toBe(false)
    expect(await source()).toContain("schematicRouteHints={[{ x: 2, y: 0 }]}")
  })

  test("refuses corners for a trace that is not there, and corners that are not points", async () => {
    expect((await edit([{ wire_corners: { from: "R1.pin1", to: "net.X", corners: [] } }])).isError).toBe(true)
    expect((await edit([{ connect: { from: "R1.pin1", to: "net.X", corners: "3,1" } }])).text).toContain("corners must be a list of { x, y }")
  })
})

describe("renaming designators", () => {
  test("rename_parts renames R7 to R2 and every reference follows", async () => {
    const result = await edit([{ rename_parts: { R7: "R2" } }])
    expect(result.isError, result.text).toBe(false)
    expect(result.text).toBe("Change c0001 applied: renamed R7 -> R2")
    expect(await source()).toMatch(/<resistor name="R2"[\s\S]*from="R2.pin1"/)
    expect(await source()).not.toContain("R7")
  })

  test("is refused with other edits or for a name taken", async () => {
    expect((await edit([{ rename_parts: { R7: "R2" } }, { add_page: { name: "P" } }])).text).toContain("rename_parts goes alone")
    expect((await edit([{ rename_parts: { R7: "R1" } }])).text).toContain("R1 would name two things")
  })
})

describe("review fixes", () => {
  test("rename_parts with another key in the same item is refused and nothing is written", async () => {
    const result = await edit([{ rename_parts: { R7: "R5" }, set_props: { part: "R1", props: { resistance: "2k" } } }])
    expect(result.isError).toBe(true)
    expect(result.text).toContain("Give exactly one of")
    expect(await source()).toBe(CIRCUIT)
  })

  test("rename_parts drops identity pairs and refuses when none are left", async () => {
    const result = await edit([{ rename_parts: { R1: "R1" } }])
    expect(result.isError).toBe(true)
    expect(result.text).toContain("R1 already has that name; nothing was written")
    expect((await call("recent_changes")).text).not.toContain("rename")
    expect((await edit([{ rename_parts: { R1: "R1", R7: "R2" } }])).text).toBe("Change c0001 applied: renamed R7 -> R2")
  })

  test("a page that does not exist and a fontSize not above 0 are refused", async () => {
    const missing = await call("add_text", { file: FILE, text: "x", x: 0, y: 0, page: "Nope" })
    expect(missing.isError).toBe(true)
    expect(missing.text).toContain('No schematic page "Nope"; the pages are Main; add_page makes one')
    expect((await edit([{ add_page: { name: "P" } }, { add_drawing: { text: "x", x: 0, y: 0, page: "P" } }])).isError).toBe(false)
    expect((await call("add_text", { file: FILE, text: "x", x: 0, y: 0, fontSize: 0 })).text).toContain("fontSize")
    expect((await edit([{ add_drawing: { text: "x", x: 0, y: 0, fontSize: -1 } }])).isError).toBe(true)
  })
})

describe("sheet ports and size", () => {
  test("rename_port and sheet_size edit a sheet file", async () => {
    const result = await edit([{ rename_port: { from: "VIN", to: "VBUS" } }, { sheet_size: { width: 4, height: 3 } }], "Stage.sheet.tsx")
    expect(result.isError, result.text).toBe(false)
    const text = await source("Stage.sheet.tsx")
    expect(text).toContain('<port name="VBUS" />')
    expect(text).toContain("net.VBUS")
    expect(text).toMatch(/<sheet width=\{4\} height=\{3\}>/)
  })

  test("sheet_size in a circuit file is refused", async () => {
    expect((await edit([{ sheet_size: { width: 4 } }])).text).toContain("only a sheet file has a symbol size")
    expect((await edit([{ sheet_size: {} }])).text).toContain("sheet_size names nothing to change")
  })
})

describe("pours and holes after they exist", () => {
  test("set_pour changes the clearance and set_hole the diameter", async () => {
    const result = await edit([{ set_pour: { id: "copperpour:1", clearance: 0.4, priority: 2 } }, { set_hole: { id: "hole:1", diameter: 3.2 } }])
    expect(result.isError, result.text).toBe(false)
    expect(result.text).toContain("set copperpour:1 clearance,priority; set hole:1 diameter")
    const text = await source()
    expect(text).toContain("clearance={0.4}")
    expect(text).toContain("diameter={3.2}")
  })

  test("refuses an unknown prop, a missing id and an empty change", async () => {
    expect((await edit([{ set_pour: { id: "copperpour:1", width: 2 } }])).text).toContain('A copper pour has no prop "width"')
    expect((await edit([{ set_hole: { id: "hole:1", plated: true } }])).text).toContain("set_hole")
    expect((await edit([{ set_hole: { id: "hole:1" } }])).text).toContain("set_hole names nothing to change")
    expect((await edit([{ set_pour: { id: "copperpour:9", clearance: 1 } }])).isError).toBe(true)
  })
})

describe("redo_change", () => {
  test("brings back the agent's own undo", async () => {
    await call("add_text", { file: FILE, text: "Rev A", x: 1, y: 2 })
    await call("undo_change")
    expect(await source()).toBe(CIRCUIT)
    const result = await call("redo_change")
    expect(result.text).toMatch(/^Change c0003 applied: Redo: add text G1/)
    expect(await source()).toContain("Rev A")
  })

  test("refuses a human's undo and says when there is nothing to redo", async () => {
    expect((await call("redo_change")).text).toBe("Nothing to redo")
    const after = CIRCUIT.replace("1k", "2k")
    await writeFile(join(root, FILE), after)
    const change = await recordEntry(root, { author: "human", file: FILE, summary: "set R1", before: CIRCUIT, after })
    await writeFile(join(root, FILE), CIRCUIT)
    await recordEntry(root, { author: "human", file: FILE, summary: "Undo: set R1", before: after, after: CIRCUIT, undoOf: change.id })
    expect((await call("redo_change")).text).toBe("Nothing to redo")
    expect((await call("redo_change", { id: change.id })).text).toBe("The agent can only redo its own undos")
  })
})
