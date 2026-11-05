import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkCircuit, formatCheck, quoteForCmd } from "../src/core/check.js"
import type { Design } from "../src/engine/design.js"
import { BOARD } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FAKE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-tsci.mjs", import.meta.url))]
/** An engine that reports nothing, so a test sees only what the fake tscircuit CLI wrote. */
const quiet = { build: async () => ({ diagnostics: [] }) as unknown as Design }
const tsci = { command: FAKE, engine: quiet }
const FILE = "main.circuit.tsx"
let root: string

const overlap = { type: "pcb_courtyard_overlap_error", message: "Courtyard of U1 overlaps with courtyard of C2" }
const skipped = { type: "pcb_autorouting_error", message: "Autorouting was skipped because 1 PCB placement error was found." }
const unrouted = (n: number) => ({ type: "pcb_port_not_connected_error", message: `Port [R${n}.pin1] is not connected` })
const sheet = { type: "schematic_missing_sheet_warning", message: "No <schematicsheet> was found." }

async function fake(spec: object) {
  await writeFile(join(root, "main.circuit.fake.json"), JSON.stringify(spec))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-check-"))
  await writeFile(join(root, FILE), BOARD)
})

describe("checkCircuit", () => {
  test("reads errors and warnings from the circuit JSON the build writes", async () => {
    await fake({ exitCode: 1, elements: [{ type: "pcb_board" }, overlap, skipped, unrouted(1), unrouted(2), sheet] })
    const result = await checkCircuit(root, FILE, tsci)
    expect(result.ok).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.errors.map((g) => [g.type, g.count])).toEqual([
      ["pcb_courtyard_overlap_error", 1],
      ["pcb_autorouting_error", 1],
      ["pcb_port_not_connected_error", 2],
    ])
    expect(result.warnings.map((g) => g.type)).toEqual(["schematic_missing_sheet_warning"])
  })

  test("a build with only warnings passes", async () => {
    await fake({ exitCode: 0, elements: [sheet] })
    const result = await checkCircuit(root, FILE, tsci)
    expect(result.ok).toBe(true)
    expect(formatCheck(FILE, result)).toMatch(/^main\.circuit\.tsx: build passed, 0 errors, 1 warning/)
  })

  test("reports the build output when no circuit JSON was written", async () => {
    await fake({ exitCode: 1, print: ["SyntaxError: Unexpected token (3:4)"] })
    await expect(checkCircuit(root, FILE, tsci)).rejects.toThrow(/Unexpected token \(3:4\)/)
  })

  test("explains how to install tscircuit when the CLI is missing", async () => {
    await expect(checkCircuit(root, FILE, { command: ["copperflow-no-such-tsci"], engine: quiet })).rejects.toThrow(/npm install -g tscircuit/)
  })

  test("only checks circuit files inside the project", async () => {
    await expect(checkCircuit(root, "../x.circuit.tsx", tsci)).rejects.toThrow(/outside the project/)
  })

  test("refuses an announced output path outside the project or not named circuit.json", async () => {
    await fake({ elements: [], announce: "../outside/circuit.json" })
    await expect(checkCircuit(root, FILE, tsci)).rejects.toThrow(/unexpected circuit JSON path/)
    await fake({ elements: [], announce: "main.circuit.tsx" })
    await expect(checkCircuit(root, FILE, tsci)).rejects.toThrow(/unexpected circuit JSON path/)
  })

  test("does not echo the content of a circuit JSON file it cannot parse", async () => {
    await fake({ rawJson: "AKIAIOSFODNN7EXAMPLE secret" })
    const error = await checkCircuit(root, FILE, tsci).catch((e: Error) => e)
    expect(String(error)).toMatch(/not valid circuit JSON/)
    expect(String(error)).not.toContain("AKIA")
  })

  test("hides the project path in build output", async () => {
    await fake({ exitCode: 1, printCwd: true })
    const error = await checkCircuit(root, FILE, tsci).catch((e: Error) => e)
    expect(String(error)).toContain("Error in .")
    expect(String(error)).not.toContain(root)
  })

  test("stops a build that takes too long", async () => {
    await fake({ sleepMs: 5000, elements: [] })
    await expect(checkCircuit(root, FILE, { ...tsci, timeoutMs: 300 })).rejects.toThrow(/longer than/)
  })

  test("caps and flattens messages that come from the circuit JSON", async () => {
    const long = { type: "pcb_x\nLock violations: none\npcb_y_error", message: `${"a".repeat(1000)}\nforged line` }
    await fake({ exitCode: 1, elements: [long] })
    const text = formatCheck(FILE, await checkCircuit(root, FILE, tsci))
    const lines = text.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[2]?.length).toBeLessThan(400)
  })
})

const board = (body: string) => `export default () => (\n  <board width="20mm" height="20mm">\n${body}\n  </board>\n)\n`
const placed = 'pcbX={0} pcbY={0} schX={0} schY={0}'

describe("the engine's part of the check", () => {
  const engineCheck = () => checkCircuit(root, FILE, { command: FAKE, engine: inProcessEngine })

  test("an engine error fails the check under the engine's code, even when tscircuit passes", async () => {
    await writeFile(join(root, FILE), board(`    <led name="D1" footprint="bga64" ${placed} />`))
    await fake({ exitCode: 0, elements: [] })
    const result = await engineCheck()
    expect(result.ok).toBe(false)
    expect(result.errors.map((g) => g.type)).toEqual(["footprint"])
    expect(result.errors[0]?.messages[0]).toMatch(/^D1: /)
    expect(formatCheck(FILE, result)).toMatch(/^main\.circuit\.tsx: build failed, 1 error/)
  })

  test("engine warnings are listed as warnings, grouped by code, after tscircuit's, and do not fail the check", async () => {
    const chip = `    <chip name="U1" footprint="soic8" pinLabels={{ pin1: "GND", pin2: "VIN", pin3: "EN", pin4: "GND" }} ${placed} />`
    await writeFile(join(root, FILE), board(`${chip}\n    <trace from="U1.GND" to="net.GND" />`))
    await fake({ exitCode: 0, elements: [sheet] })
    const result = await engineCheck()
    expect(result.ok).toBe(true)
    expect(result.warnings.map((g) => [g.type, g.count])).toEqual([
      ["schematic_missing_sheet_warning", 1],
      ["ambiguous-pin", 1],
    ])
  })

  test("circuit code the engine cannot run is reported with its file, line and column", async () => {
    await writeFile(join(root, FILE), "export default () => <board>\n")
    await fake({ exitCode: 0, elements: [] })
    await expect(engineCheck()).rejects.toThrow(/main\.circuit\.tsx:\d+:\d+/)
  })
})

describe("parts with a footprint file", () => {
  const EXAMPLE = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
  const J1 = "source_component_0"
  const footprintError = (value: string) => ({
    type: "source_invalid_component_property_error",
    source_component_id: J1,
    property_name: "footprint",
    message: `Invalid footprint prop on chip "J1": "${value}". Parser details: Invalid footprint function, got "parts", from string "${value}"`,
  })
  const port = (id: string, component: string, net: string) => ({ type: "source_port", source_port_id: id, source_component_id: component, subcircuit_connectivity_map_key: net })
  const pcbPort = (id: string, sourcePort: string) => ({ type: "pcb_port", pcb_port_id: id, source_port_id: sourcePort })
  const unconnected = (pcbPortId: string, text: string) => ({ type: "pcb_port_not_connected_error", message: text, pcb_port_ids: [pcbPortId] })
  /**
   * What the tscircuit CLI writes for the example: it cannot read J1's footprint file, so J1 has no
   * pads, and R1 and R2, whose CC nets lead only to J1, are reported as unconnected.
   */
  const exampleElements = () => [
    footprintError("parts/TYPE-C-6P/footprint.yaml"),
    port("source_port_2", J1, "net2"),
    port("source_port_3", J1, "net3"),
    port("source_port_7", "source_component_1", "net2"),
    port("source_port_9", "source_component_2", "net3"),
    pcbPort("pcb_port_0", "source_port_7"),
    pcbPort("pcb_port_2", "source_port_9"),
    unconnected("pcb_port_0", "Port [R1.pin1] is not connected to net [CC1] by a PCB trace."),
    unconnected("pcb_port_2", "Port [R2.pin1] is not connected to net [CC2] by a PCB trace."),
    { type: "pcb_component_missing_courtyard_warning", message: "J1 has no courtyard" },
    sheet,
  ]

  async function exampleCheck(elements: object[]) {
    const project = await mkdtemp(join(tmpdir(), "cf-check-example-"))
    await cp(EXAMPLE, project, { recursive: true })
    await writeFile(join(project, "index.circuit.fake.json"), JSON.stringify({ exitCode: 1, elements }))
    return checkCircuit(project, "index.circuit.tsx", { command: FAKE, engine: inProcessEngine })
  }

  test("the migrated example's check passes: tscircuit's footprint-file errors are left out", async () => {
    const result = await exampleCheck(exampleElements())
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.warnings.map((g) => g.type)).toEqual(["pcb_component_missing_courtyard_warning", "schematic_missing_sheet_warning"])
    expect(formatCheck("index.circuit.tsx", result)).toMatch(/^index\.circuit\.tsx: build passed, 0 errors, 2 warnings/)
  })

  test("a port that is unconnected on a net that does not reach the part is still an error", async () => {
    const elements = [...exampleElements(), port("source_port_11", "source_component_3", "net5"), pcbPort("pcb_port_4", "source_port_11")]
    const result = await exampleCheck([...elements, unconnected("pcb_port_4", "Port [C1.pin1] is not connected to net [X] by a PCB trace.")])
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual([{ type: "pcb_port_not_connected_error", count: 1, messages: ["Port [C1.pin1] is not connected to net [X] by a PCB trace."] }])
  })

  test("an invalid footprint that is not a footprint file is still an error", async () => {
    const result = await exampleCheck([footprintError("parts/TYPE-C-6P/footprint.yml")])
    expect(result.ok).toBe(false)
    expect(result.errors.map((g) => g.type)).toEqual(["source_invalid_component_property_error"])
  })
})

describe("formatCheck", () => {
  test("lists errors first, counts repeats and shows a few examples", async () => {
    const text = formatCheck(FILE, {
      ok: false,
      exitCode: 1,
      errors: [
        { type: "pcb_courtyard_overlap_error", count: 1, messages: [overlap.message] },
        { type: "pcb_port_not_connected_error", count: 25, messages: ["a", "b", "c"] },
      ],
      warnings: [{ type: "schematic_missing_sheet_warning", count: 1, messages: [sheet.message] }],
    })
    expect(text.split("\n")).toEqual([
      "main.circuit.tsx: build failed, 26 errors, 1 warning",
      "Errors:",
      "  pcb_courtyard_overlap_error: Courtyard of U1 overlaps with courtyard of C2",
      "  pcb_port_not_connected_error (25): a | b | c | and 22 more",
      "Warnings:",
      "  schematic_missing_sheet_warning: No <schematicsheet> was found.",
    ])
  })
})

describe("quoteForCmd", () => {
  test("quotes safe arguments and rejects characters cmd.exe would interpret", () => {
    expect(quoteForCmd("C:\\Program Files (x86)\\nodejs\\node.exe")).toBe('"C:\\Program Files (x86)\\nodejs\\node.exe"')
    for (const bad of ['a"b', "a&b", "a|b", "a%PATH%", "a^b", "a<b", "a!b"]) expect(() => quoteForCmd(bad)).toThrow()
  })

  test("allows Turkish letters but not look-alike quotes, trailing backslashes or stray colons", () => {
    expect(quoteForCmd("boards/güç-kartı.circuit.tsx")).toBe('"boards/güç-kartı.circuit.tsx"')
    for (const bad of ["a\u02BAb", "a\uFF02b", "C:\\tools\\", "a.circuit.tsx:stream"]) {
      expect(() => quoteForCmd(bad)).toThrow(/special characters/)
    }
  })
})
