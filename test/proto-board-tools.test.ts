import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "vitest"
import { editCircuit } from "../src/core/index.js"
import { boardSkeleton } from "../src/core/netlist.js"
import { generateCircuit } from "../src/core/new-circuit.js"
import { exportBuildSheet } from "../src/core/build-sheet.js"
import { buildDesign } from "../src/engine/design.js"
import { fitBoard } from "../src/engine/pcb-place/index.js"
import { buildSheet, stripLines } from "../src/engine/proto/build-sheet.js"
import { fitProto } from "../src/engine/proto/fit.js"
import { gridAround } from "../src/engine/proto/grid.js"
import { snapPositions } from "../src/engine/proto/snap.js"
import { fitTool } from "../src/mcp/folded-tools.js"
import { exportTool } from "../src/mcp/export-tool.js"
import { QUIET } from "../src/mcp/tool-activity.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
const engine = inProcessEngine as never
const circuit = (board: string, body: readonly string[]) => `export default () => (\n  <board ${board}>\n${body.map((line) => `    ${line}`).join("\n")}\n  </board>\n)\n`
const HEADERS = ['<pinheader name="J1" pinCount={3} pitch="2.54mm" pcbX={-6} pcbY={1} />', '<pinheader name="J2" pinCount={2} pitch="2.54mm" pcbX={5} pcbY={-3} />', '<trace from="J1.pin1" to="net.A" />', '<trace from="J2.pin1" to="net.A" />']

async function project(text: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cf-proto-tools-"))
  await writeFile(join(root, FILE), text)
  return root
}

describe("fit_board { kind }", () => {
  test("turns a PCB into a perfboard, puts the parts on holes and fits the board round them", async () => {
    const root = await project(circuit('width="30mm" height="20mm"', HEADERS))
    const answer = await fitTool({ root, engine }, { file: FILE, kind: "perfboard" })
    const lines = answer.split("\n")
    const [first, second] = lines
    const last = lines.at(-1)
    expect(first).toMatch(/^Change c\d+: the board is now a perfboard of 12 × 8 holes$/)
    expect(second).toMatch(/^Change c\d+: 2 parts put on the holes, the board fitted to \d+ × \d+ holes$/)
    expect(last).toBe('Then: autoroute, and render { view: "board" } for each side.')
    const text = await readFile(join(root, FILE), "utf8")
    expect(text).toMatch(/<board kind="perfboard" columns=\{\d+\} rows=\{\d+\}/)
    expect(text).not.toMatch(/width=/)
    const built = await inProcessEngine.build(root, FILE)
    expect(built.violations.filter((v) => /proto-(off-grid|outside|hole-shared)/.test(v.code))).toEqual([])
  }, 30_000)

  test("turns it back into a PCB of the same size, and says when nothing changes", async () => {
    const root = await project(circuit('kind="stripboard" columns={10} rows={6} strips="columns"', []))
    expect(await fitTool({ root, engine }, { file: FILE, kind: "stripboard" })).toBe("The board is already a stripboard. Nothing was written.")
    expect(await fitTool({ root, engine }, { file: FILE, kind: "pcb" })).toMatch(/^Change c\d+: the board is now a made PCB of 25\.4 × 15\.24 mm$/)
    expect(await readFile(join(root, FILE), "utf8")).toMatch(/<board width=\{25\.4\} height=\{15\.24\}>|<board width="?25\.4/)
    await expect(fitTool({ root, engine }, { file: FILE, kind: "perfboard", width: 20 })).rejects.toThrow("kind changes the board alone; leave out width. Nothing was written.")
  }, 30_000)

  test("refuses a board drawn as an outline", async () => {
    const root = await project(circuit('outline={[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]}', []))
    await expect(fitTool({ root, engine }, { file: FILE, kind: "perfboard" })).rejects.toThrow(/a perfboard is a rectangle of holes|A perfboard is a rectangle of holes/)
  }, 30_000)

  test("fit_board with no size fits a proto board in whole holes", async () => {
    const root = await project(circuit('kind="perfboard" columns={30} rows={30}', ['<pinheader name="J1" pinCount={3} pitch="2.54mm" pcbX={1.27} pcbY={1.27} />']))
    expect(await fitTool({ root, engine }, { file: FILE })).toMatch(/^Change c\d+: board 5 × 3 holes \(one free hole all round\)$/)
    const built = await inProcessEngine.build(root, FILE)
    expect(built.pcb.board?.proto).toMatchObject({ columns: 5, rows: 3 })
    expect(built.violations.filter((v) => v.code.startsWith("proto-") && v.code !== "proto-open")).toEqual([])
  }, 30_000)

  test("setBoard with columns refuses a bad count", async () => {
    const root = await project(circuit('kind="perfboard" columns={10} rows={6}', []))
    await expect(editCircuit(root, FILE, [{ kind: "setBoard", width: 10, height: 10, x: 0, y: 0, columns: 1, rows: 5 }], { author: "ai", summary: "x" })).rejects.toThrow("board columns must be a whole number of holes from 2 to 200")
  }, 30_000)
})

describe("new_circuit with a board kind", () => {
  test("writes the board in whole holes", () => {
    expect(boardSkeleton({ width: 30, height: 20, kind: "stripboard" })).toBe('export default () => (\n  <board kind="stripboard" columns={12} rows={8}>\n  </board>\n)\n')
    expect(boardSkeleton({ width: 30, height: 20 })).toBe('export default () => (\n  <board width="30mm" height="20mm">\n  </board>\n)\n')
  })

  test("refuses pours on a hole grid", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-proto-new-"))
    const spec = { parts: [{ name: "J1", kind: "pinheader", props: { pinCount: 2 } }], nets: { GND: ["J1.pin1", "J1.pin2"] }, board: { kind: "perfboard" as const }, pours: [{ net: "GND", layer: "bottom" }] }
    await expect(generateCircuit(root, FILE, spec)).rejects.toThrow("A perfboard has no copper pours; leave pours out")
  })
})

describe("fitting and snapping", () => {
  const grid = gridAround("perfboard", 10, 6, { x: 0, y: 0 })

  test("fits whole holes round the points with a free hole all round, on the same lattice", () => {
    const fit = fitProto(grid, [{ x: 1.27, y: 1.27 }, { x: 3.81, y: 1.27 }])
    expect(fit).toMatchObject({ columns: 4, rows: 3 })
    if ("error" in fit) throw new Error(fit.error)
    // The holes stay on the lattice: (fit.centre - first) is a whole or half number of pitches.
    const halves = ((fit.centre.x - grid.first.x) / 2.54) * 2
    expect(Math.abs(halves - Math.round(halves))).toBeLessThan(1e-9)
    expect(fitProto(grid, [])).toEqual({ error: "there are no parts to fit the board to" })
    expect(fitProto(grid, [{ x: 0, y: 0 }, { x: 1000, y: 0 }])).toMatchObject({ error: expect.stringMatching(/more than 200 a side/) })
  })

  test("a resistor on stripboard is turned across the strips and its pins dropped into holes", () => {
    const text = circuit('kind="stripboard" columns={10} rows={10}', ['<resistor name="R1" resistance="1k" footprint="axial6.3x10.16" pcbX={0.3} pcbY={0.4} />'])
    const built = buildDesign({ [FILE]: text }, FILE)
    const { positions, notes } = snapPositions(built.pcb, new Map([["R1", { x: 0.3, y: 0.4, rotation: 0 }]]))
    expect(notes).toEqual([])
    expect(positions.get("R1")?.rotation).toBe(90)
    const placed = buildDesign({ [FILE]: text.replace("pcbX={0.3} pcbY={0.4}", `pcbX={${positions.get("R1")?.x}} pcbY={${positions.get("R1")?.y}} pcbRotation={90}`) }, FILE)
    expect(placed.violations.filter((v) => v.code.startsWith("proto-"))).toEqual([])
  })

  test("a part with no room, or with no through pins, is left with a note", () => {
    const headers = [1, 2, 3].map((n) => `<pinheader name="J${n}" pinCount={3} pitch="2.54mm" pcbX={0} pcbY={0} />`)
    const text = circuit('kind="perfboard" columns={3} rows={2}', [...headers, '<resistor name="R9" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />'])
    const built = buildDesign({ [FILE]: text }, FILE)
    const at = { x: 0, y: 0, rotation: 0 }
    const { notes } = snapPositions(built.pcb, new Map([["J1", at], ["J2", at], ["J3", at], ["R9", at]]))
    expect(notes).toContain("R9 has no through-hole pins, so it was left where the placer put it")
    expect(notes.some((note) => /^J\d found no free holes near where the placer put it; it was left there \(fit: true grows the board\)$/.test(note))).toBe(true)
    expect(snapPositions(buildDesign({ [FILE]: circuit('width="5mm" height="5mm"', []) }, FILE).pcb, new Map()).notes).toEqual([])
  })

  test("fitBoard on a proto board answers holes", () => {
    const built = buildDesign({ [FILE]: circuit('kind="perfboard" columns={30} rows={30}', ['<pinheader name="J1" pinCount={3} pitch="2.54mm" pcbX={1.27} pcbY={1.27} />']) }, FILE)
    expect(fitBoard(built)).toMatchObject({ holes: { columns: 5, rows: 3 } })
  })
})

describe("the build sheet", () => {
  const records = [
    { t: "cut", id: "x1", between: ["C2", "C3"] },
    { t: "cut", id: "x2", at: "C5" },
    { t: "link", id: "w1", net: "A", from: "C1", to: "E1" },
  ]
  const body = ['<pinheader name="J1" pinCount={3} pitch="2.54mm" pcbX={-6.35} pcbY={1.27} />', '<pinheader name="J2" pinCount={3} pitch="2.54mm" pcbX={-6.35} pcbY={-3.81} />', '<trace from="J1.pin1" to="net.A" />', '<trace from="J2.pin1" to="net.A" />', '<trace from="J1.pin3" to="net.B" />']
  const built = buildDesign({ [FILE]: circuit('kind="stripboard" columns={10} rows={6}', body), "main.circuit.layout.json": records.map((r) => JSON.stringify(r)).join("\n") }, FILE)
  const grid = built.pcb.board?.proto
  if (!grid) throw new Error("no grid")
  const input = { name: "main", grid, circuit: built.circuit, layout: built.pcb }

  test("says what each strip carries between its cuts", () => {
    expect(stripLines(input, (net) => (net ?? "").replace("net.", ""))).toEqual(["- Strip C: 1–2 A · 3–4 B", "- Strip E: 1–10 A"])
  })

  test("lists the parts' holes, the cuts and the links", () => {
    const text = buildSheet({ ...input, pictures: { top: "t.png", bottom: "b.png" } })
    expect(text).toMatch(/^# main: stripboard build sheet\n\nStripboard, 10 columns by 6 rows of 2\.54 mm holes, strips along the rows\./)
    expect(text).toContain("![Top: parts and links](t.png)")
    expect(text).toContain("| J1 | pinheader | pinrow3_p2.54mm | C2 (1), C3 (2), C4 (3) |")
    expect(text).toContain("| X1 | between C2 and C3: cut across with a knife |")
    expect(text).toContain("| X2 | at C5: drill the hole's copper away |")
    expect(text).toContain("| W1 | A | C1 | E1 | 5.1 mm |")
    expect(text).toContain("1. Cut the strips from the cut list on the bottom")
  })

  test("a perfboard sheet lists its solder runs instead of cuts", () => {
    const perf = buildDesign({ [FILE]: circuit('kind="perfboard" columns={10} rows={6}', body), "main.circuit.layout.json": JSON.stringify({ t: "solder", id: "s1", net: "A", holes: ["C2", "D2", "E2"] }) }, FILE)
    const perfGrid = perf.pcb.board?.proto
    if (!perfGrid) throw new Error("no grid")
    const text = buildSheet({ name: "main", grid: perfGrid, circuit: perf.circuit, layout: perf.pcb })
    expect(text).toContain("| S1 | A | C2 → D2 → E2 |")
    expect(text).not.toContain("## Cuts")
    expect(text).toContain("## Links (top, 0)\n\nNone.")
  })

  test("export { as: \"build\" } writes it, and refuses a made PCB and out", async () => {
    const root = await project(circuit('kind="stripboard" columns={10} rows={6}', body))
    const missing = async () => {
      throw Object.assign(new Error("Cannot find package '@napi-rs/canvas'"), { code: "ERR_MODULE_NOT_FOUND" })
    }
    const result = await exportBuildSheet(root, FILE, { engine, canvas: missing })
    expect(result).toEqual({ files: ["main-build.md"], note: "The pictures were left out: drawing them needs the optional package @napi-rs/canvas." })
    const ports = { root, engine, report: QUIET }
    const refused = await exportTool(ports, { file: FILE, as: "build", out: "x" })
    expect(refused.isError).toBe(true)
    const pcb = await project(circuit('width="10mm" height="10mm"', []))
    const notProto = await exportTool({ ...ports, root: pcb }, { file: FILE, as: "build" })
    expect(JSON.stringify(notProto.content)).toContain('as \\"build\\" is for a perfboard or stripboard')
  }, 30_000)
})
