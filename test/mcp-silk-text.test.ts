// Text on the board's silkscreen through MCP: add_text with a layer, edit_circuit's add_drawing / set_drawing /
// remove_drawing by its id, and board_summary listing it.
import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
const CIRCUIT = `export default () => (
  <board width={30} height={20}>
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-5} pcbY={0} />
    <trace from=".R1 > .pin1" to="net.V5" />
  </board>
)
`

let root: string
let client: Client

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-mcp-silk-"))
  await writeFile(join(root, FILE), CIRCUIT)
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
const edit = (edits: unknown[]) => call("edit_circuit", { file: FILE, edits })
const source = () => readFile(join(root, FILE), "utf8")

describe("board text through MCP", () => {
  test("add_text with a layer puts the words on the silkscreen and names their id", async () => {
    const result = await call("add_text", { file: FILE, text: "IO-8 v1", x: 0, y: 8, layer: "top", height: 2 })
    expect(result.isError, result.text).toBe(false)
    expect(result.text).toMatch(/^Change c0001 applied: add silkscreentext:1 "IO-8 v1" on the top silkscreen, its ink x -[\d.]+ to [\d.]+, y [\d.]+ to [\d.]+ mm/)
    // 2 mm tall about y = 8: the ink is the letters' height and a stroke wider.
    const [, low, high] = /y ([\d.]+) to ([\d.]+) mm/.exec(result.text) ?? []
    expect(Number(high) - Number(low)).toBeGreaterThan(2)
    expect(Number(high) - Number(low)).toBeLessThan(2.6)
    expect(await source()).toContain('<silkscreentext text="IO-8 v1" x={0} y={8} layer="top" height={2} />')
  })

  test("add_text refuses a schematic page or font size with a layer, and too small a height, in plain words", async () => {
    expect((await call("add_text", { file: FILE, text: "x", x: 0, y: 0, layer: "top", page: "Main" })).text).toMatch(/page and fontSize are for a schematic note/)
    const small = await call("add_text", { file: FILE, text: "tiny", x: 0, y: 0, layer: "bottom", height: 0.4 })
    expect(small.isError).toBe(true)
    expect(small.text).toContain("height must be at least 0.8 mm")
  })

  test("edit_circuit adds, moves, rewords and removes it by its id", async () => {
    const added = await edit([{ add_drawing: { text: "under", x: 2, y: -8, layer: "bottom", rotation: 90 } }])
    expect(added.isError, added.text).toBe(false)
    expect(added.text).toContain('add silkscreen text "under" on the bottom')
    const moved = await edit([{ set_drawing: { id: "silkscreentext:1", x: -3, text: "UNDER" } }])
    expect(moved.isError, moved.text).toBe(false)
    expect(await source()).toContain('<silkscreentext text="UNDER" x={-3} y={-8} layer="bottom" rotation={90} />')
    const summary = await call("board_summary", { file: FILE })
    expect(summary.text).toContain('Silkscreen text (1):\n  silkscreentext:1 "UNDER" bottom at (-3.0, -8.0), 1.5 mm, turned 90°')
    const removed = await edit([{ remove_drawing: { id: "silkscreentext:1" } }])
    expect(removed.isError, removed.text).toBe(false)
    expect(await source()).not.toContain("silkscreentext")
  })
})
