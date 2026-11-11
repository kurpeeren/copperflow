import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { listEntries, loadCircuit, updateAnnotations } from "../src/core/index.js"
import { lockParts } from "../src/core/annotations.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { DEMO } from "./helpers/new-circuit-demo.js"

const EXAMPLE = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
const FILE = DEMO.file
const PLACED = /^Placed \d+ parts?; wire length \d+ mm \(was \d+\); board [\d.]+ × [\d.]+ mm; \d+ overlaps?$/m
let root: string
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-place-tool-"))
  await cp(EXAMPLE, root, { recursive: true })
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

describe("new_circuit places the board", () => {
  test("by default: the answer has the placement line, the parts get positions, and a second entry by the agent holds them", async () => {
    const answer = await call("new_circuit", DEMO)
    expect(answer.isError).toBe(false)
    expect(answer.text).toMatch(PLACED)
    expect(answer.text).toMatch(/Now call check_circuit once\.$/)
    const text = await readFile(join(root, FILE), "utf8")
    expect(text).toMatch(/pcbX=\{/)
    const entries = (await listEntries(root, 10)).filter((e) => e.file === FILE)
    expect(entries.map((e) => e.author)).toEqual(["ai", "ai"])
    expect(entries.some((e) => e.summary.startsWith("Autoplace the board"))).toBe(true)
  })

  test("place: false writes the parts without positions", async () => {
    const answer = await call("new_circuit", { ...DEMO, place: false })
    expect(answer.text).not.toMatch(PLACED)
    expect(await readFile(join(root, FILE), "utf8")).not.toMatch(/pcbX=\{/)
  })
})

describe("autoplace and fit_board", () => {
  test("autoplace answers in the agreed line, leaves a locked part alone, and fit_board reshapes the board", async () => {
    await call("new_circuit", { ...DEMO, place: false })
    const { model } = await loadCircuit(root, FILE)
    const locked = model.parts[0]?.name as string
    await updateAnnotations(root, FILE, (a) => lockParts(a, model, [locked], new Date().toISOString()))
    const before = await readFile(join(root, FILE), "utf8")
    const placed = await call("autoplace", { file: FILE })
    expect(placed.isError).toBe(false)
    expect(placed.text.split("\n")[0]).toMatch(PLACED)
    expect(placed.text).toMatch(/^Change c\d{4}; undo_change takes it back\.$/m)
    const after = await readFile(join(root, FILE), "utf8")
    const line = (text: string) => text.split("\n").find((l) => l.includes(`name="${locked}"`))
    expect(line(after)).toBe(line(before))
    const again = await call("autoplace", { file: FILE })
    expect(again.text).toMatch(/^Nothing to place/)
    const fit = await call("fit_board", { file: FILE, margin: 1 })
    expect(fit.text).toMatch(/^Change c\d{4}: board [\d.]+ × [\d.]+ mm \(margin 1 mm\)$/)
  })

  test("refuses both parts and instance, and an unknown part", async () => {
    await call("new_circuit", { ...DEMO, place: false })
    expect((await call("autoplace", { file: FILE, parts: ["R1"], instance: "PS1" })).text).toMatch(/Give parts or instance/)
    expect((await call("autoplace", { file: FILE, parts: ["Q99"] })).text).toMatch(/no part Q99/)
  })

  test("fit_board refuses a board drawn with a non-rectangular outline", async () => {
    await writeFile(join(root, "tri.circuit.tsx"), `export default () => (\n  <board outline={[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }]}>\n    <resistor name="R1" resistance="1k" footprint="0603" pcbX={3} pcbY={3} />\n  </board>\n)\n`)
    const answer = await call("fit_board", { file: "tri.circuit.tsx" })
    expect(answer.isError).toBe(true)
    expect(answer.text).toMatch(/not one/)
  })
})
