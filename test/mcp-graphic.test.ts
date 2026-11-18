// A drawing placed on the board through MCP and the CLI: import_graphic, edit_circuit's set_drawing / remove_drawing by
// its id, board_summary listing it, and `copperflow graphic`.
import { beforeEach, describe, expect, test } from "vitest"
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { runCli } from "../src/cli-commands.js"
import { graphicRequest } from "../src/cli-graphic.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
const CIRCUIT = `export default () => (
  <board width={30} height={20}>
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-10} pcbY={-6} />
  </board>
)
`
/** A 10 × 5 mm frame with a hole, and a line with no fill; one text element the reader leaves out. */
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="5mm" viewBox="0 0 10 5">
  <path d="M0 0 H10 V5 H0 Z M2 1 H4 V4 H2 Z" fill="black" fill-rule="evenodd"/>
  <line x1="0" y1="0" x2="10" y2="5" stroke="black" stroke-width="0.3"/>
  <text x="1" y="1">hi</text>
</svg>`

let root: string
let client: Client

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-mcp-graphic-"))
  await writeFile(join(root, FILE), CIRCUIT)
  await mkdir(join(root, "art"))
  await writeFile(join(root, "art", "logo.svg"), LOGO)
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
const source = () => readFile(join(root, FILE), "utf8")

describe("import_graphic", () => {
  test("copies the drawing into graphics/, places it at the board's centre, and says its size and what was left out", async () => {
    const result = await call("import_graphic", { file: FILE, source: "art/logo.svg", layer: "top-silkscreen", width: 8 })
    expect(result.isError, result.text).toBe(false)
    expect(result.text).toMatch(/^Change c0001: boardgraphic:1 from graphics\/logo.svg on the top-silkscreen, 8 x 4 mm, centred at \(0, 0\)/)
    expect(result.text).toMatch(/Left out of the file: .*text/)
    expect(await readFile(join(root, "graphics", "logo.svg"), "utf8")).toBe(LOGO)
    expect(await source()).toContain('<boardgraphic file="graphics/logo.svg" layer="top-silkscreen" x={0} y={0} width={8} />')
    const summary = await call("board_summary", { file: FILE })
    expect(summary.text).toContain("Drawings (1):\n  boardgraphic:1 graphics/logo.svg top-silkscreen at (0.0, 0.0), 8.0 x 4.0 mm")
  })

  test("puts it on copper, says what is checked, and copper_summary lists it", async () => {
    const result = await call("import_graphic", { file: FILE, source: "art/logo.svg", layer: "bottom", x: 5, y: 4, width: 6 })
    expect(result.isError, result.text).toBe(false)
    expect(result.text).toContain("on the bottom, 6 x 3 mm")
    expect(result.text).toContain("On copper it belongs to no net")
    const summary = await call("copper_summary", { file: FILE })
    expect(summary.text).toContain("Drawings on copper: boardgraphic:1 graphics/logo.svg bottom at (5, 4), 6.0 x 3.0 mm, no net")
  })

  test("takes a net on copper, and refuses one the circuit lacks or one off copper, writing nothing", async () => {
    const missing = await call("import_graphic", { file: FILE, source: "art/logo.svg", layer: "top", net: "NOPE" })
    expect(missing.text).toMatch(/import_graphic was refused: The drawing names the net NOPE, which the circuit does not have \(.*\)\. Nothing was written\.$/)
    const silk = await call("import_graphic", { file: FILE, source: "art/logo.svg", layer: "top-silkscreen", net: "GND" })
    expect(silk.text).toContain("net is only for a drawing on copper")
    expect(await source()).toBe(CIRCUIT)
    expect(graphicRequest(["main.circuit.tsx", "art/logo.svg", "--layer", "top", "--net", "GND"]).options.net).toBe("GND")
  })

  test("on a net it names the net, and the centre of an off-centre board is written to the micron", async () => {
    await writeFile(join(root, FILE), `export default () => (
  <board width={43.4} height={24.2} pcbX={0.9} pcbY={-1}>
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-10} pcbY={-6} />
    <trace from="R1.pin1" to="net.GND" />
  </board>
)
`)
    const result = await call("import_graphic", { file: FILE, source: "art/logo.svg", layer: "top", net: "GND", width: 4 })
    expect(result.isError, result.text).toBe(false)
    expect(result.text).toMatch(/^Change c0001: boardgraphic:1 from graphics\/logo.svg on the top on net GND, 4 x 2 mm, centred at \(0.9, -1\)/)
    expect(await source()).toContain('layer="top" net="GND" x={0.9} y={-1} width={4}')
  })

  test("a drawing of light shapes only is drawn as ink, and the answer says so without calling it left out", async () => {
    await writeFile(join(root, "art", "white.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="8mm" height="4mm" viewBox="0 0 8 4"><rect width="8" height="4" fill="white"/></svg>`)
    const result = await call("import_graphic", { file: FILE, source: "art/white.svg", layer: "top-silkscreen" })
    expect(result.isError, result.text).toBe(false)
    expect(result.text).toContain("Nothing in the file was left out.")
    expect(result.text).toContain("The file has no dark shape, so its light shapes are drawn as ink; gradients and images are not read.")
    expect(result.text).not.toContain("Dark shapes are ink")
  })

  test("refuses a missing file and an unreadable one in plain words, writing nothing", async () => {
    await writeFile(join(root, "art", "bad.svg"), "not a drawing")
    const missing = await call("import_graphic", { file: FILE, source: "art/none.svg", layer: "top-mask" })
    expect(missing.text).toMatch(/import_graphic was refused: There is no file art\/none.svg in the project folder.*Nothing was written\.$/)
    const bad = await call("import_graphic", { file: FILE, source: "art/bad.svg", layer: "top-mask" })
    expect(bad.text).toMatch(/import_graphic was refused: bad.svg: .*Nothing was written\.$/)
    expect(await source()).toBe(CIRCUIT)
  })
})

describe("edit_circuit on a drawing", () => {
  test("moves, re-layers and resizes it by its id, then removes it", async () => {
    await call("import_graphic", { file: FILE, source: "art/logo.svg", layer: "top-silkscreen", x: 5, y: 3, width: 8 })
    const set = await call("edit_circuit", { file: FILE, edits: [{ set_drawing: { id: "boardgraphic:1", x: -2, layer: "bottom-mask", scale: 0.5, rotation: 90, fill: true } }] })
    expect(set.isError, set.text).toBe(false)
    expect(await source()).toContain('<boardgraphic file="graphics/logo.svg" layer="bottom-mask" x={-2} y={3} scale={0.5} rotation={90} fill={true} />')
    const copper = await call("edit_circuit", { file: FILE, edits: [{ set_drawing: { id: "boardgraphic:1", net: "GND" } }] })
    expect(copper.text).toContain("net is only for a drawing on copper")
    const netted = await call("edit_circuit", { file: FILE, edits: [{ set_drawing: { id: "boardgraphic:1", layer: "top", net: "GND", fill: null } }] })
    expect(netted.isError, netted.text).toBe(false)
    expect(await source()).toContain('layer="top" x={-2} y={3} scale={0.5} rotation={90} net="GND"')
    const cleared = await call("edit_circuit", { file: FILE, edits: [{ set_drawing: { id: "boardgraphic:1", net: null } }] })
    expect(cleared.isError, cleared.text).toBe(false)
    expect(await source()).not.toContain('net="GND"')
    const removed = await call("edit_circuit", { file: FILE, edits: [{ remove_drawing: { id: "boardgraphic:1" } }] })
    expect(removed.isError, removed.text).toBe(false)
    expect(await source()).not.toContain("boardgraphic")
  })
})

describe("copperflow graphic", () => {
  test("reads its arguments and places the drawing", async () => {
    expect(graphicRequest(["main.circuit.tsx", "art/logo.svg", "--layer", "bottom-silkscreen", "--at", "3,-2", "--scale", "2", "--fill", "--name", "logo"])).toEqual({
      file: "main.circuit.tsx",
      options: { source: "art/logo.svg", layer: "bottom-silkscreen", x: 3, y: -2, width: undefined, scale: 2, rotation: undefined, fill: true, name: "logo" },
    })
    expect(() => graphicRequest(["main.circuit.tsx", "art/logo.svg"])).toThrow(/Missing --layer\. Usage: copperflow graphic/)
    const [out, err]: [string[], string[]] = [[], []]
    const code = await runCli(["graphic", FILE, "art/logo.svg", "--layer", "top-mask", "--at", "4,2", "--width", "6"], root, { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: inProcessEngine })
    expect(err.join("\n")).toBe("")
    expect(code).toBe(0)
    expect(out.join("\n")).toContain("boardgraphic:1 from graphics/logo.svg on the top-mask, 6 x 3 mm, centred at (4, 2)")
    const help: string[] = []
    await runCli(["help"], root, { out: (s) => help.push(s), err: () => undefined })
    expect(help.join("\n")).toContain("copperflow graphic <file> <drawing.svg|dxf> --layer")
  })
})

describe("what the reader gives", () => {
  test("a drawing with nothing to draw is refused, naming what was left out", async () => {
    await writeFile(join(root, "art", "words.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="5mm" viewBox="0 0 10 5"><text x="1" y="1">a</text><text x="1" y="3">b</text></svg>`)
    const result = await call("import_graphic", { file: FILE, source: "art/words.svg", layer: "top-silkscreen" })
    expect(result.text).toMatch(/words.svg: the drawing has nothing to draw \(left out: .*text.*\)\. Nothing was written\.$/)
  })

  test("overlapping fills from separate elements (colour ignored) are one dark region, with no seam", async () => {
    const { buildDesign } = await import("../src/engine/design.js")
    const { gerberFiles } = await import("../src/engine/fab/layers.js")
    const { readGerber } = await import("./helpers/gerber-read.js")
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10mm" height="10mm" viewBox="0 0 10 10"><rect x="0" y="0" width="8" height="8" fill="black"/><rect x="2" y="2" width="8" height="8" fill="white"/></svg>`
    const files = { [FILE]: CIRCUIT.replace("</board>", `<boardgraphic file="graphics/two.svg" layer="top-silkscreen" x={0} y={0} />\n  </board>`), "graphics/two.svg": svg }
    const design = buildDesign(files, FILE)
    const plain = buildDesign({ [FILE]: CIRCUIT }, FILE)
    const legend = (d: typeof design) => readGerber(gerberFiles(d.pcb, d.rules.fabrication, "b", new Date(0)).find((f) => f.file.startsWith("b-F_Silkscreen."))?.text ?? "").regions
    const added = legend(design).length - legend(plain).length
    expect(added).toBe(1)
    expect(design.pcb.graphics?.[0]?.areas).toHaveLength(1)
  })
})

const exists = (path: string) => access(path).then(() => true, () => false)

describe("what import_graphic refuses before anything is kept", () => {
  test("a centre off the board writes neither the circuit nor graphics/", async () => {
    const result = await call("import_graphic", { file: FILE, source: "art/logo.svg", layer: "top-silkscreen", x: 500, y: 500 })
    expect(result.text).toMatch(/lies outside the board.*Nothing was written\.$/)
    expect(await exists(join(root, "graphics", "logo.svg"))).toBe(false)
    expect(await source()).toBe(CIRCUIT)
  })

  test("a success says where the drawing is kept and that it stays", async () => {
    const result = await call("import_graphic", { file: FILE, source: "art/logo.svg", layer: "top-mask" })
    expect(result.text).toContain("The drawing is kept as graphics/logo.svg; it stays there if the change is undone.")
  })

  test("a folder, a file over 4 MB and a link leading outside the project are refused in plain words", async () => {
    await mkdir(join(root, "art", "folder.svg"))
    expect((await call("import_graphic", { file: FILE, source: "art/folder.svg", layer: "top-mask" })).text).toContain("art/folder.svg is not a file")
    await writeFile(join(root, "art", "big.svg"), "x".repeat(4 * 1024 * 1024 + 1))
    expect((await call("import_graphic", { file: FILE, source: "art/big.svg", layer: "top-mask" })).text).toContain("art/big.svg is larger than 4 MB")
    const outside = await mkdtemp(join(tmpdir(), "cf-outside-"))
    await writeFile(join(outside, "o.svg"), LOGO)
    const linked = await symlink(outside, join(root, "link"), "junction").then(() => true, () => false)
    if (!linked) return
    const result = await call("import_graphic", { file: FILE, source: "link/o.svg", layer: "top-mask" })
    expect(result.text).toContain("link/o.svg leads outside the project folder")
    expect(await source()).toBe(CIRCUIT)
  })
})
