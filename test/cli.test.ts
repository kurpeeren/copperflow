import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runCli } from "../src/cli-commands.js"
import { readAnnotations } from "../src/core/annotations.js"
import { createPart } from "../src/core/library.js"
import { BOARD, LDO, SHARED } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
/** A circuit the engine builds without errors or warnings. */
const CLEAN = `export default () => (
  <board width="10mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} schX={0} schY={0} />
  </board>
)
`
/** A chip whose EN pin is connected to nothing. */
const FLOATING = `export default () => (
  <board width="20mm" height="20mm">
    <chip name="U1" footprint="soic8" pinLabels={{ pin1: "GND", pin2: "VIN", pin3: "EN", pin4: "GND" }} pinAttributes={{ EN: { isInput: true } }} pcbX={0} pcbY={0} schX={0} schY={0} />
    <trace from="U1.pin1" to="net.GND" />
    <trace from="U1.pin2" to="net.VIN" />
  </board>
)
`
let root: string
let out: string[]
let err: string[]
const io = () => ({ out: (s: string) => out.push(s), err: (s: string) => err.push(s) })
const run = (...args: string[]) => runCli(args, root, io(), { engine: inProcessEngine })
const sidecar = () => readAnnotations(join(root, "main.circuit.annotations.json"))

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-cli-"))
  await writeFile(join(root, FILE), BOARD)
  await writeFile(join(root, "shared.ts"), SHARED)
  out = []
  err = []
})

describe("cli", () => {
  test("lock and unlock change the sidecar", async () => {
    expect(await run("lock", FILE, "R1", "C1")).toBe(0)
    expect((await sidecar()).locks.map((l) => l.part)).toEqual(["R1", "C1"])
    expect(await run("unlock", FILE, "R1")).toBe(0)
    expect((await sidecar()).locks.map((l) => l.part)).toEqual(["C1"])
  })

  test("mark adds a positioned note and unmark removes it", async () => {
    expect(await run("mark", FILE, "route GND here", "--pcb", "10,5")).toBe(0)
    expect((await sidecar()).marks[0]).toMatchObject({ id: "m1", view: "pcb", x: 10, y: 5 })
    expect(await run("unmark", FILE, "m1")).toBe(0)
    expect((await sidecar()).marks).toEqual([])
  })

  test("summary, history and help print text", async () => {
    expect(await run("summary", FILE)).toBe(0)
    expect(out.join("\n")).toContain("R1 <resistor>")
    expect(await run("history")).toBe(0)
    expect(out.join("\n")).toContain("No changes recorded yet.")
    expect(await run("help")).toBe(0)
    expect(out.join("\n")).toContain("copperflow mcp")
  })

  test("check exits 0 for a clean circuit and prints a passing report", async () => {
    await writeFile(join(root, FILE), CLEAN)
    expect(await run("check", FILE)).toBe(0)
    expect(out.join("\n")).toMatch(/^main\.circuit\.tsx: check passed, 0 errors/)
  })

  test("check exits 1 and lists the errors for a circuit with a floating pin", async () => {
    await writeFile(join(root, FILE), FLOATING)
    expect(await run("check", FILE)).toBe(1)
    expect(out.join("\n")).toMatch(/pin-unconnected:\n {4}U1\.pin3 \(EN\) is not connected/)
  })

  test("check fails on the engine's errors, such as BOARD's two parts named RX", async () => {
    expect(await run("check", FILE)).toBe(1)
    expect(out.join("\n")).toContain("duplicate-name")
    expect(out.join("\n")).toContain("More than one part is named RX")
  })

  test("check rejects the old --tsci option and says why", async () => {
    await writeFile(join(root, FILE), CLEAN)
    expect(await run("check", FILE, "--tsci", "tsci")).toBe(1)
    expect(err.join("\n")).toMatch(/--tsci is no longer an option/)
    expect(out).toEqual([])
  })

  test("parts: list, rebuild and verify by a person", async () => {
    expect(await run("parts")).toBe(0)
    expect(out.join("\n")).toContain("The parts library is empty")
    await createPart(root, "LDO", LDO, { now: "t" })
    const person = { ...io(), ask: async () => "LDO" }
    expect(await runCli(["parts", "verify", "LDO", "--by", "Eren", "--against", "AP2112 datasheet p.2"], root, person)).toBe(0)
    expect(await run("parts")).toBe(0)
    expect(out.join("\n")).toContain("LDO  <LDO>  AP2112K-3.3 LDO regulator  sot23_5  verified by Eren")
    expect(await run("parts", "build")).toBe(0)
    expect(out.join("\n")).toContain("parts/LDO/LDO.tsx")
    expect(await run("parts", "verify", "LDO")).toBe(1)
  })

  test("place, bom and package", async () => {
    await createPart(root, "LDO", LDO, { now: "t" })
    expect(await run("place", FILE, "LDO", "U7", "pcbX=4", "footprintVariant=wide")).toBe(0)
    expect(await readFile(join(root, FILE), "utf8")).toContain('<LDO name="U7" pcbX={4} footprintVariant="wide" />')
    expect(await run("bom", FILE)).toBe(0)
    expect(out.join("\n")).toContain("| U7 | 1 | chip |")
    expect(await run("bom", FILE, "--csv")).toBe(0)
    expect(out.join("\n")).toContain("Designators,Quantity,Kind")
    expect(await run("package", FILE)).toBe(0)
    expect(out.join("\n")).toContain("exports/main/BOM.csv")
    // main.circuit.tsx sits at the project root, so its package folder is exports/main.
    expect(await run("place", FILE, "LDO", "U8", "broken")).toBe(1)
  })

  test("bom and package no longer take --build", async () => {
    expect(await run("bom", FILE, "--build")).toBe(1)
    expect(err.join("\n")).toContain("--build")
    err = []
    expect(await run("package", FILE, "--build")).toBe(1)
    expect(err.join("\n")).toContain("--build")
  })

  test("a circuit-code error in a BOM build is reported as file:line:column", async () => {
    await writeFile(join(root, FILE), "export default () => <board>\n")
    expect(await run("bom", FILE)).toBe(1)
    expect(err.join("\n")).toMatch(/main\.circuit\.tsx:\d+:\d+: /)
  })

  test("errors are reported with a non-zero exit code", async () => {
    expect(await run("lock", FILE, "NOPE")).toBe(1)
    expect(err.join("\n")).toContain("NOPE")
    expect(await run("mark", FILE, "x", "--pcb", "ten,5")).toBe(1)
    expect(await run("undo")).toBe(1)
    expect(await run("frobnicate")).toBe(1)
    expect(err.join("\n")).toContain("Unknown command")
  })
})
