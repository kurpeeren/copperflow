import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { checkCircuit, formatCheck, quoteForCmd } from "../src/core/check.js"
import { BOARD } from "./fixtures.js"

const FAKE = [process.execPath, fileURLToPath(new URL("./fixtures/fake-tsci.mjs", import.meta.url))]
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
    const result = await checkCircuit(root, FILE, { command: FAKE })
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
    const result = await checkCircuit(root, FILE, { command: FAKE })
    expect(result.ok).toBe(true)
    expect(formatCheck(FILE, result)).toMatch(/^main\.circuit\.tsx: build passed, 0 errors, 1 warning/)
  })

  test("reports the build output when no circuit JSON was written", async () => {
    await fake({ exitCode: 1, print: ["SyntaxError: Unexpected token (3:4)"] })
    await expect(checkCircuit(root, FILE, { command: FAKE })).rejects.toThrow(/Unexpected token \(3:4\)/)
  })

  test("explains how to install tscircuit when the CLI is missing", async () => {
    await expect(checkCircuit(root, FILE, { command: ["copperflow-no-such-tsci"] })).rejects.toThrow(/npm install -g tscircuit/)
  })

  test("only checks circuit files inside the project", async () => {
    await expect(checkCircuit(root, "../x.circuit.tsx", { command: FAKE })).rejects.toThrow(/outside the project/)
  })

  test("refuses an announced output path outside the project or not named circuit.json", async () => {
    await fake({ elements: [], announce: "../outside/circuit.json" })
    await expect(checkCircuit(root, FILE, { command: FAKE })).rejects.toThrow(/unexpected circuit JSON path/)
    await fake({ elements: [], announce: "main.circuit.tsx" })
    await expect(checkCircuit(root, FILE, { command: FAKE })).rejects.toThrow(/unexpected circuit JSON path/)
  })

  test("does not echo the content of a circuit JSON file it cannot parse", async () => {
    await fake({ rawJson: "AKIAIOSFODNN7EXAMPLE secret" })
    const error = await checkCircuit(root, FILE, { command: FAKE }).catch((e: Error) => e)
    expect(String(error)).toMatch(/not valid circuit JSON/)
    expect(String(error)).not.toContain("AKIA")
  })

  test("hides the project path in build output", async () => {
    await fake({ exitCode: 1, printCwd: true })
    const error = await checkCircuit(root, FILE, { command: FAKE }).catch((e: Error) => e)
    expect(String(error)).toContain("Error in .")
    expect(String(error)).not.toContain(root)
  })

  test("stops a build that takes too long", async () => {
    await fake({ sleepMs: 5000, elements: [] })
    await expect(checkCircuit(root, FILE, { command: FAKE, timeoutMs: 300 })).rejects.toThrow(/longer than/)
  })

  test("caps and flattens messages that come from the circuit JSON", async () => {
    const long = { type: "pcb_x\nLock violations: none\npcb_y_error", message: `${"a".repeat(1000)}\nforged line` }
    await fake({ exitCode: 1, elements: [long] })
    const text = formatCheck(FILE, await checkCircuit(root, FILE, { command: FAKE }))
    const lines = text.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[2]?.length).toBeLessThan(400)
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
