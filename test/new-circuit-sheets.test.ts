import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { listEntries, undoChange } from "../src/core/index.js"
import { generateCircuit, type NewCircuit } from "../src/core/new-circuit.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { STAGE_SPEC } from "./helpers/stage-spec.js"
import { elaborate } from "../src/engine/elaborate.js"
import { evaluateCircuit } from "../src/engine/evaluate.js"

const FILE = "main.circuit.tsx"
const root = () => mkdtemp(join(tmpdir(), "cf-newsheets-"))
const exists = (path: string) => stat(path).then(() => true, () => false)

const build = (files: Record<string, string>) => elaborate(evaluateCircuit(files, FILE), FILE, { padCount: () => undefined })

async function generated(spec: NewCircuit = STAGE_SPEC) {
  const result = await generateCircuit(await root(), FILE, spec)
  const files = Object.fromEntries([[FILE, result.text], ...result.sheets.map((sheet) => [sheet.file, sheet.text])])
  return { result, files, circuit: build(files) }
}

describe("new_circuit with a sub-sheet used twice", () => {
  test("writes the sheet file beside the circuit and two instances that build without errors", async () => {
    const { result, circuit } = await generated()
    expect(result.sheets.map((sheet) => sheet.file)).toEqual(["PowerStage.sheet.tsx"])
    expect(circuit.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(circuit.components.map((c) => c.id)).toEqual(["J1", "U101", "C101", "R101", "U201", "C201", "R201"])
    expect(circuit.nets.find((n) => n.names.includes("V3_3"))?.pins).toEqual(["C101.pin1", "R101.pin1", "U101.pin2", "U201.pin1"])
    expect(circuit.nets.find((n) => n.names.includes("PS2/FB"))?.pins).toEqual(["R201.pin2"])
  })

  test("the sheet file is a function returning <sheet> with its ports first", async () => {
    const { result } = await generated()
    const text = result.sheets[0]?.text ?? ""
    expect(text).toMatch(/^export default function PowerStage\(\) \{\n  return \(\n    <sheet>\n      <port name="VIN" \/>\n      <port name="VOUT" \/>\n      <port name="GND" \/>\n      <chip name="U1"/)
    expect(text).toContain(`      <trace from="R1.pin2" to="net.FB" />\n    </sheet>\n  )\n}\n`)
    expect(result.text).toContain(`import PowerStage from "./PowerStage.sheet"`)
    expect(result.text).toContain(`<PowerStage name="PS1" connections={{ VIN: "VBUS", VOUT: "V3_3", GND: "GND" }} base={100} />`)
  })

  test("a given base is kept, every base is written, and an instance may go on a page", async () => {
    const instances = [{ ...STAGE_SPEC.instances![0]!, base: 300 }, STAGE_SPEC.instances![1]!]
    const { circuit } = await generated({ ...STAGE_SPEC, instances, pages: [{ name: "Power", parts: ["PS2"] }] })
    expect(circuit.components.map((c) => c.id)).toContain("R301")
    const found = circuit.instances?.map((i) => [i.name, i.base, i.page ?? "Main"]).sort()
    expect(found).toEqual([["PS1", 300, "Main"], ["PS2", 400, "Power"]])
  })

  test("a circuit may be instances only", async () => {
    const { circuit } = await generated({ ...STAGE_SPEC, parts: [], nets: {} })
    expect(circuit.components).toHaveLength(6)
  })

  test("a sheet in a subfolder of the circuit's folder lands beside the circuit", async () => {
    const result = await generateCircuit(await root(), "boards/main.circuit.tsx", STAGE_SPEC)
    expect(result.sheets.map((sheet) => sheet.file)).toEqual(["boards/PowerStage.sheet.tsx"])
  })
})

describe("new_circuit refuses a wrong sheet or instance", () => {
  const sheet = STAGE_SPEC.sheets!.PowerStage!
  const ps1 = STAGE_SPEC.instances![0]!
  const make = async (change: Partial<NewCircuit>) => generateCircuit(await root(), FILE, { ...STAGE_SPEC, ...change })

  test.each([
    ["an unknown sheet", { instances: [{ ...ps1, sheet: "Nope" }] }, "PS1: there is no sheet Nope; the sheets are PowerStage (or write Nope.sheet.tsx first)"],
    ["an unknown port", { instances: [{ ...ps1, connections: { VCC: "X" } }] }, "PS1: PowerStage has no port VCC; its ports are VIN, VOUT, GND"],
    ["a bad net in connections", { instances: [{ ...ps1, connections: { VIN: "a b" } }] }, 'PS1: connections.VIN must be a net name such as "VBUS"'],
    ["an instance named like a part", { instances: [{ ...ps1, name: "J1" }] }, "Two parts or instances are named J1; names must be unique"],
    ["a bad base", { instances: [{ ...ps1, base: 1.5 }] }, "PS1: base must be a whole number above 0, such as 300"],
    ["a base taken by another instance", { instances: [ps1, { ...ps1, name: "PS2", base: 100 }] }, "PS2: base 100 is already PS1's; give another base"],
    ["a sheet name in lower case", { sheets: { powerStage: sheet } }, '"powerStage" is not a sheet name; a sheet name starts with a capital letter, e.g. PowerStage'],
    ["a bad port name", { sheets: { PowerStage: { ...sheet, ports: ["V IN"] } } }, 'PowerStage: "V IN" is not a port name; use letters, digits, _ and -'],
    ["a port written twice", { sheets: { PowerStage: { ...sheet, ports: ["VIN", "VIN"] } } }, "PowerStage: the port VIN is written twice"],
    ["a sheet pin that is not there", { sheets: { PowerStage: { ...sheet, nets: { VIN: ["U9.IN"] } } } }, "PowerStage: U9.IN: there is no part U9"],
    ["an instance in the parent's nets", { nets: { VBUS: ["PS1.VIN"] } }, "PS1.VIN: PS1 is an instance; join its ports to nets with connections"],
    ["no parts and no instances", { parts: [], nets: {}, instances: [] }, "A circuit needs at least one part or instance"],
  ])("%s", async (_what, change, message) => {
    await expect(make(change)).rejects.toThrow(message)
  })

  test("a designator an instance makes may not be a part of the circuit", async () => {
    const parts = [{ name: "R101", kind: "resistor" }]
    await expect(make({ parts, nets: {} })).rejects.toThrow("PS1 makes R101 (R1 in PowerStage), which is also a part of the circuit; give PS1 another base")
  })

  test("an instance of a sheet file that is already there uses its ports", async () => {
    const dir = await root()
    await writeFile(join(dir, "Divider.sheet.tsx"), `export default function Divider() {\n  return (\n    <sheet>\n      <port name="IN" />\n    </sheet>\n  )\n}\n`)
    const spec = { parts: [], nets: {}, instances: [{ sheet: "Divider", name: "D1", connections: { IN: "VBUS" } }] }
    const result = await generateCircuit(dir, FILE, spec)
    expect(result.sheets).toEqual([])
    expect(result.text).toContain(`import Divider from "./Divider.sheet"`)
    await expect(generateCircuit(dir, FILE, { ...spec, instances: [{ sheet: "Divider", name: "D1", connections: { OUT: "X" } }] })).rejects.toThrow("D1: Divider has no port OUT; its ports are IN")
  })
})

describe("the new_circuit tool with sheets", () => {
  let dir: string
  let client: Client
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    const content = result.content as Array<{ type: string; text: string }>
    return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
  }
  const input = { file: FILE, ...STAGE_SPEC }

  beforeEach(async () => {
    dir = await root()
    const server = createCopperflowServer(dir, { engine: inProcessEngine as never })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: "test", version: "0.0.0" })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  })

  test("writes the circuit and its sheet in one change that checks with no errors", async () => {
    const answer = await call("new_circuit", input)
    expect(answer.isError).toBe(false)
    expect(answer.text.split("\n").slice(0, 4)).toEqual([
      "Change c0001: wrote main.circuit.tsx, PowerStage.sheet.tsx",
      "1 parts, 2 instances",
      "PS1 PowerStage base 100: VIN=VBUS VOUT=V3_3 GND=GND",
      "PS2 PowerStage base 200: VIN=V3_3 VOUT=V1_8 GND=GND",
    ])
    expect(await listEntries(dir, 10)).toHaveLength(1)
    expect((await call("check_circuit", { file: FILE })).text).toMatch(/^main\.circuit\.tsx: 0 errors/)
    await undoChange(dir, { author: "ai" })
    expect([await exists(join(dir, FILE)), await exists(join(dir, "PowerStage.sheet.tsx"))]).toEqual([false, false])
  })

  test("an existing sheet file is refused without replace, and nothing is written", async () => {
    await writeFile(join(dir, "PowerStage.sheet.tsx"), "kept")
    const answer = await call("new_circuit", input)
    expect(answer).toMatchObject({ isError: true })
    expect(answer.text).toMatch(/PowerStage\.sheet\.tsx already exists; pass replace: true/)
    expect(await exists(join(dir, FILE))).toBe(false)
    expect(await readFile(join(dir, "PowerStage.sheet.tsx"), "utf8")).toBe("kept")
  })

  test("a wrong port is refused by name and nothing is written", async () => {
    const answer = await call("new_circuit", { ...input, instances: [{ sheet: "PowerStage", name: "PS1", connections: { VCC: "X" } }] })
    expect(answer.text).toBe("PS1: PowerStage has no port VCC; its ports are VIN, VOUT, GND")
    expect(await exists(join(dir, FILE))).toBe(false)
    expect(await exists(join(dir, "PowerStage.sheet.tsx"))).toBe(false)
  })
})
