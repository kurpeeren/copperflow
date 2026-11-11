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
import { buildDesign, type Design } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { ratsnestLength } from "../src/engine/pcb-place/score.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
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

const build = async (file = FILE): Promise<Design> => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), file)
const positioned = (text: string) => (text.match(/pcbX=\{/g) ?? []).length

/** The placement line's numbers, and those the files before and after give: parts placed, wire lengths, board, overlaps. */
function checkPlacedLine(line: string, before: { design: Design; text: string }, after: { design: Design; text: string }): void {
  const match = /^Placed (\d+) parts?; wire length (\d+) mm \(was (\d+)\); board ([\d.]+) × ([\d.]+) mm; (\d+) overlaps?$/.exec(line)
  expect(match, line).not.toBeNull()
  const [placed, wire, was, width, height, overlaps] = (match as RegExpExecArray).slice(1).map(Number) as number[]
  expect(placed).toBe(positioned(after.text) - positioned(before.text))
  expect(placed).toBeGreaterThan(0)
  expect(Math.abs((wire as number) - ratsnestLength(after.design.pcb.parts))).toBeLessThanOrEqual(1)
  expect(Math.abs((was as number) - ratsnestLength(before.design.pcb.parts))).toBeLessThanOrEqual(1)
  const outline = after.design.pcb.board?.outline ?? []
  const span = (values: number[]) => Math.round((Math.max(...values) - Math.min(...values)) * 10) / 10
  expect([width, height]).toEqual([span(outline.map((p) => p.x)), span(outline.map((p) => p.y))])
  expect(overlaps).toBe(after.design.violations.filter((v) => v.code === "courtyard-overlap").length)
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

  test("the placement line gives the real counts and wire lengths; undoing the placement entry leaves the file new_circuit wrote, and it builds", async () => {
    const answer = await call("new_circuit", DEMO)
    const placed = { text: await readFile(join(root, FILE), "utf8"), design: await build() }
    const undone = await call("undo_change", {})
    expect(undone.isError).toBe(false)
    const text = await readFile(join(root, FILE), "utf8")
    const design = await build()
    expect(design.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(design.pcb.parts).toHaveLength(DEMO.parts.length)
    checkPlacedLine(answer.text.split("\n").find((l) => l.startsWith("Placed ")) ?? "", { text, design }, placed)
    await call("new_circuit", { ...DEMO, place: false, replace: true })
    expect(await readFile(join(root, FILE), "utf8")).toBe(text)
    const { tools } = await client.listTools()
    const description = tools.find((t) => t.name === "new_circuit")?.description ?? ""
    expect(description).toContain("the placement is a second entry")
    expect(description).not.toContain("One history entry for the circuit and its sheet files;")
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
    const beforeDesign = await build()
    const placed = await call("autoplace", { file: FILE })
    expect(placed.isError).toBe(false)
    checkPlacedLine(placed.text.split("\n")[0] ?? "", { text: before, design: beforeDesign }, { text: await readFile(join(root, FILE), "utf8"), design: await build() })
    expect(placed.text).toMatch(/^Change c\d{4}; undo_change takes it back\.$/m)
    const after = await readFile(join(root, FILE), "utf8")
    const line = (text: string) => text.split("\n").find((l) => l.includes(`name="${locked}"`))
    expect(line(after)).toBe(line(before))
    const again = await call("autoplace", { file: FILE })
    expect(again.text).toMatch(/^Nothing to place/)
    const fit = await call("fit_board", { file: FILE, margin: 1 })
    expect(fit.text).toMatch(/^Change c\d{4}: board [\d.]+ × [\d.]+ mm \(margin 1 mm\)$/)
  })

  test("when nothing could be written it says so first instead of claiming parts were placed", async () => {
    await writeFile(join(root, "Stage.sheet.tsx"), `export default function Stage() {\n  return (\n    <sheet>\n      <port name="VIN" />\n      <port name="GND" />\n      <resistor name="R1" resistance="1k" footprint="0603" />\n      <trace from="R1.pin1" to="net.VIN" />\n      <trace from="R1.pin2" to="net.GND" />\n    </sheet>\n  )\n}\n`)
    const main = "two.circuit.tsx"
    await writeFile(join(root, main), `import Stage from "./Stage.sheet"\nexport default () => (\n  <board width="40mm" height="30mm">\n    <Stage name="S1" connections={{ VIN: "VBUS", GND: "GND" }} pcbX={8} pcbY={-6} />\n    <Stage name="S2" connections={{ VIN: "VBUS", GND: "GND" }} pcbX={-8} pcbY={8} />\n  </board>\n)\n`)
    const { model } = await loadCircuit(root, main)
    await updateAnnotations(root, main, (a) => lockParts(a, model, ["S1"], new Date().toISOString()))
    const answer = await call("autoplace", { file: main })
    expect(answer.isError).toBe(false)
    const lines = answer.text.split("\n")
    expect(lines[0]).toMatch(/^Nothing to move/)
    expect(answer.text).not.toMatch(/^Placed /m)
    expect(answer.text).toMatch(/R201 shares R1 of Stage\.sheet\.tsx with R101, which is locked; it was not moved/)
  })

  test("an instance on a schematic page is placed; once placed, the answer says its parts already have positions", async () => {
    const stage = { parts: [{ name: "R1", kind: "resistor", value: "1k", footprint: "0603" }, { name: "C1", kind: "capacitor", value: "1uF", footprint: "0603" }], nets: { VIN: ["R1.pin1"], VOUT: ["R1.pin2", "C1.pin1"], GND: ["C1.pin2"] }, ports: ["VIN", "VOUT", "GND"] }
    const spec = {
      file: "paged.circuit.tsx",
      sheets: { Power: stage },
      instances: [{ sheet: "Power", name: "PS1", connections: { VIN: "V5", VOUT: "V3_3", GND: "GND" } }],
      parts: [{ name: "J1", kind: "pinheader", props: { pinCount: 3 } }],
      nets: { V5: ["J1.pin1"], V3_3: ["J1.pin2"], GND: ["J1.pin3"] },
      pages: [{ name: "Power", parts: ["PS1"] }],
    }
    expect((await call("new_circuit", { ...spec, place: false })).isError).toBe(false)
    expect((await call("autoplace", { file: spec.file, instance: "PS1" })).text).toMatch(/^Placed 2 parts/)
    expect((await call("new_circuit", { ...spec, replace: true })).text).toMatch(PLACED)
    const again = await call("autoplace", { file: spec.file, instance: "PS1" })
    expect(again.text).toMatch(/^Nothing to place: every part of PS1 already has a position or is locked; autoplace moves only parts without one\./)
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
