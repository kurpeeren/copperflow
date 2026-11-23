// The tools that let a board be designed through MCP alone: set_rules, fit_board with a size, outline and layers,
// render to a file, the pads of a package and of a library part, and set_part_fields.
import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { verifyPart } from "../src/core/library.js"
import type { Renderer } from "../src/core/render.js"
import { resolveCircuit } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"

/** Builds in this process with the files the engine reads, rules.yaml among them. */
const inProcessEngine = {
  build: async (root: string, file: string) => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file),
  buildFiles: async (files: Record<string, string>, main: string) => buildDesign(files, main),
}

const FILE = "main.circuit.tsx"
const CIRCUIT = `export default () => (
  <board width={30} height={20}>
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={5} pcbY={0} />
    <trace from=".R1 > .pin1" to="net.V5" />
    <trace from=".R2 > .pin1" to="net.V5" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R2 > .pin2" to="net.GND" />
  </board>
)
`
/** A renderer that draws nothing: the tool's writing is what is tested. */
const fakeRenderer = async (): Promise<Renderer> =>
  ({
    renderDesign: () => ({ png: new Uint8Array([137, 80, 78, 71]), width: 2, height: 2, what: "PCB" }),
  }) as unknown as Renderer

let root: string
let client: Client

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-mcp-board-"))
  await writeFile(join(root, FILE), CIRCUIT)
  const server = createCopperflowServer(root, { engine: inProcessEngine })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.filter((c) => c.type === "text").map((c) => c.text).join("\n"), isError: result.isError === true, content }
}

describe("set_rules", () => {
  test("adds a net class, writes rules.yaml as one entry and says what it means for the board", async () => {
    const result = await call("set_rules", { rules: { netClasses: { power: { nets: ["GND", "V5"], trackWidth: 0.5 } } } })
    expect(result.isError).toBe(false)
    expect(result.text).toMatch(/^Change c0001: rules\.yaml netClasses = /)
    expect(result.text).toContain("GND, V5 are class power: 0.5 mm tracks, 0.2 mm clearance")
    expect(await readFile(join(root, "rules.yaml"), "utf8")).toContain("trackWidth: 0.5")
    expect((await call("recent_changes")).text).toContain("Set rules")
    expect((await call("undo_change")).isError).toBe(false)
    expect(existsSync(join(root, "rules.yaml"))).toBe(false)
  })

  test("names the tracks narrower than their new class", async () => {
    const drawn = await call("route_track", { file: FILE, from: "R1.pin1", to: "R2.pin1" })
    expect(drawn.isError, drawn.text).toBe(false)
    const result = await call("set_rules", { rules: { netClasses: { power: { nets: ["V5"], trackWidth: 0.5 } } } })
    expect(result.text).toContain("1 existing track is narrower: remove their router copper (remove_copper { nets }) and autoroute V5")
  })

  test("merges into what is there, keeps comments, and null removes a key", async () => {
    await writeFile(join(root, "rules.yaml"), "# house rules\nfabrication:\n  minClearance: 0.15\n")
    const set = await call("set_rules", { rules: { fabrication: { profile: "jlcpcb-4layer" } } })
    expect(set.text).toContain("fabrication.profile")
    expect(set.text).toContain("The profile jlcpcb-4layer is for 4 copper layers; the board has 2: fit_board { layers: 4 } changes it")
    const text = await readFile(join(root, "rules.yaml"), "utf8")
    expect(text).toContain("# house rules")
    expect(text).toContain("minClearance: 0.15")
    const removed = await call("set_rules", { rules: { fabrication: { minClearance: null } } })
    expect(removed.text).toContain("fabrication.minClearance removed")
  })

  test("refuses a value the file would refuse, with the schema's message, and writes nothing", async () => {
    const bad = await call("set_rules", { rules: { netClasses: { power: { nets: ["V5"], trackWidth: "wide" } } } })
    expect(bad.isError).toBe(true)
    expect(bad.text).toContain('netClasses.power.trackWidth: "wide" is not a positive length such as 0.2, 0.2mm or 8mil')
    const unknown = await call("set_rules", { rules: { fabrication: { profile: "fab-x" } } })
    expect(unknown.text).toContain('unknown profile "fab-x"')
    const key = await call("set_rules", { rules: { colours: "red" } })
    expect(key.text).toContain('Unrecognized key: "colours"')
    expect(existsSync(join(root, "rules.yaml"))).toBe(false)
  })

  test("refuses a change that changes nothing", async () => {
    await call("set_rules", { rules: { fabrication: { minClearance: 0.15 } } })
    const again = await call("set_rules", { rules: { fabrication: { minClearance: 0.15 } } })
    expect(again.isError).toBe(true)
    expect(again.text).toContain("already says that")
  })

  test("project_status shows the rules in force", async () => {
    expect((await call("project_status")).text).toContain("Rules: jlcpcb-2layer (2 layers); default tracks 0.25 mm, clearance 0.2 mm")
    await call("set_rules", { rules: { netClasses: { power: { nets: ["GND", "V5"], trackWidth: 0.5 } } } })
    expect((await call("project_status")).text).toContain("class power 0.5/0.2 mm: GND, V5")
  })
})

describe("fit_board with a size, an outline and layers", () => {
  test("width and height set that rectangle and name the parts left outside", async () => {
    const result = await call("fit_board", { file: FILE, width: 8, height: 6 })
    expect(result.isError).toBe(false)
    expect(result.text).toContain("board 8 × 6 mm at (0, 0)")
    expect(result.text).toContain("2 placed parts are now outside the board: R1, R2")
    expect(await readFile(join(root, FILE), "utf8")).toContain("<board width={8} height={6}>")
  })

  test("an outline replaces the rectangle; layers sets the copper layers", async () => {
    const outline = [{ x: -15, y: -10 }, { x: 15, y: -10 }, { x: 15, y: 10 }, { x: -15, y: 10 }]
    const shaped = await call("fit_board", { file: FILE, outline, layers: 4 })
    expect(shaped.text).toContain("board outline of 4 corners, 4 copper layers")
    expect(shaped.text).not.toContain("outside")
    const source = await readFile(join(root, FILE), "utf8")
    expect(source).toContain("outline=")
    expect(source).toContain("layers={4}")
  })

  test("without a size it still fits the board round the parts", async () => {
    expect((await call("fit_board", { file: FILE })).text).toMatch(/^Change c0001: board [\d.]+ × [\d.]+ mm \(margin/)
  })

  test("refuses arguments that do not go together", async () => {
    for (const [args, words] of [
      [{ width: 10 }, "Give width and height together"],
      [{ width: 10, height: 5, outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }, "not both"],
      [{ width: 10, height: 5, margin: 2 }, "margin is for fitting"],
      [{ x: 3 }, "x and y place the centre"],
      [{ width: 1e-9, height: 1e-9 }, "at least 1 mm"],
      [{ width: 0.004, height: 5 }, "at least 1 mm"],
    ] as const) {
      const result = await call("fit_board", { file: FILE, ...args })
      expect(result.isError).toBe(true)
      expect(result.text).toContain(words)
    }
    const crossing = await call("fit_board", { file: FILE, outline: [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 0 }, { x: 0, y: 4 }] })
    expect(crossing.isError).toBe(true)
    expect(crossing.text).toContain("not a simple polygon")
  })
})

describe("render out", () => {
  test("writes the picture into the project and still answers it", async () => {
    const server = createCopperflowServer(root, { engine: inProcessEngine, renderer: fakeRenderer })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    const own = new Client({ name: "test", version: "0.0.0" })
    await Promise.all([server.connect(serverSide), own.connect(clientSide)])
    const result = await own.callTool({ name: "render", arguments: { file: FILE, out: "pics/top.png" } })
    const content = result.content as Array<{ type: string; text?: string }>
    expect(content[0]?.type).toBe("image")
    expect(content[1]?.text).toContain("Wrote pics/top.png")
    expect(existsSync(join(root, "pics", "top.png"))).toBe(true)
    const wrongEnd = await own.callTool({ name: "render", arguments: { file: FILE, out: "top.jpg" } })
    expect(wrongEnd.isError).toBe(true)
    expect((wrongEnd.content as Array<{ text: string }>)[0]?.text).toContain("ending in .png")
    const outside = await own.callTool({ name: "render", arguments: { file: FILE, out: "../top.png" } })
    expect(outside.isError).toBe(true)
    expect((outside.content as Array<{ text: string }>)[0]?.text).toContain("outside the project root")
    const stream = await own.callTool({ name: "render", arguments: { file: FILE, out: "z.png:s.png" } })
    expect(stream.isError).toBe(true)
    expect((stream.content as Array<{ text: string }>)[0]?.text).toContain('":"')
  })
})

describe("pads", () => {
  test("a packages search that finds a few lists each pad with its role", async () => {
    const jack = (await call("guide", { topic: "packages dcjack" })).text
    expect(jack).toContain("dcjack pads: number, centre, size (mm), hole, role")
    expect(jack).toMatch(/^ {2}1 {2}at \(.+\) .+ hole .+ {2}centre pin$/m)
    expect(jack).toContain("sleeve")
    expect((await call("guide", { topic: "packages sod123f" })).text).toMatch(/^ {2}2 .+ {2}cathode$/m)
    expect((await call("guide", { topic: "packages soic" })).text).not.toContain("pads: number")
  })

  test("list_parts { id } lists the footprint's pads under the pins", async () => {
    await call("create_part", { id: "LDO", title: "LDO", package: "sot23_5", pins: "1 VIN power_in\n2 GND ground\n3 EN input\n4 NC no_connect\n5 VOUT power_out" })
    const info = (await call("list_parts", { id: "LDO" })).text
    expect(info).toContain("--- pads of sot23_5: number, centre, size (mm), hole, pin ---")
    expect(info).toMatch(/^ {2}5 {2}at \(.+\) .+ {2}VOUT$/m)
    expect(info.indexOf("--- pads")).toBeLessThan(info.indexOf("--- verification.md ---"))
  })
})

describe("set_part_fields", () => {
  const create = () => call("create_part", { id: "X16M", title: "16 MHz crystal", package: "hc49s", pins: "1 XTAL1 passive\n2 XTAL2 passive", suppliers: { jlcpcb: "C1" } })

  test("sets the supplier number and mpn and keeps the pins and footprint", async () => {
    await create()
    const result = await call("set_part_fields", { id: "X16M", suppliers: { lcsc: "C16212" }, mpn: "X322516MLB4SI" })
    expect(result.isError).toBe(false)
    expect(result.text).toContain("Changed X16M: mpn \"X322516MLB4SI\", lcsc C16212.")
    expect(result.text).toContain("NOT verified")
    const yaml = await readFile(join(root, "parts", "X16M", "part.yaml"), "utf8")
    expect(yaml).toContain("lcsc: C16212")
    expect(yaml).toContain("jlcpcb: C1")
    expect(yaml).toContain("footprint: hc49s")
    expect(yaml).toContain("name: XTAL1")
    const removed = await call("set_part_fields", { id: "X16M", suppliers: { jlcpcb: null } })
    expect(removed.text).toContain("supplier jlcpcb removed")
  })

  test("refuses a verified part, a call that changes nothing and an unknown part", async () => {
    await create()
    await verifyPart(root, "X16M", { by: "Ada", against: "sheet p1" }, "2026-11-18T10:00:00.000Z")
    const verified = await call("set_part_fields", { id: "X16M", mpn: "Y" })
    expect(verified.isError).toBe(true)
    expect(verified.text).toContain("Part X16M is verified by Ada")
    expect(await readFile(join(root, "parts", "X16M", "part.yaml"), "utf8")).not.toContain("mpn: Y")
    await call("create_part", { id: "X2", title: "x", package: "hc49s", pins: "1 A passive\n2 B passive" })
    expect((await call("set_part_fields", { id: "X2", description: null })).text).toContain("already has those values")
    const unknown = await call("set_part_fields", { id: "nope", mpn: "Z" })
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toBe("No library part nope; list_parts shows them")
  })

  test("an empty string removes a field", async () => {
    await create()
    await call("set_part_fields", { id: "X16M", mpn: "M1" })
    expect((await call("set_part_fields", { id: "X16M", mpn: "" })).text).toContain("mpn removed")
    expect(await readFile(join(root, "parts", "X16M", "part.yaml"), "utf8")).not.toContain("mpn")
  })
})

describe("words that misled", () => {
  test("trace and track say which they are; edit_circuit names what it cannot do", async () => {
    const { tools } = await client.listTools()
    const description = (name: string) => tools.find((tool) => tool.name === name)?.description ?? ""
    expect(description("add_trace")).toMatch(/^Schematic trace/)
    const edits = tools.find((tool) => tool.name === "edit_circuit")?.inputSchema.properties?.edits as { items?: { properties?: Record<string, { description?: string }> } } | undefined
    expect(edits?.items?.properties?.disconnect?.description).toMatch(/^A schematic trace/)
    expect(description("route_track")).toMatch(/^Copper track/)
    expect(description("list_parts")).toContain("Built-in kinds")
    expect(description("check_circuit")).toContain("after autoplace, after autoroute and after removing copper")
    expect(description("export")).toContain("pictures")
    const refused = await call("edit_circuit", { file: FILE, edits: [{ route_track: { net: "V5" } }] })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain("Copper, the board's size and shape, design rules and library parts are not edited through it")
  })
})
