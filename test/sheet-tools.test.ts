import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { listEntries } from "../src/core/index.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { STAGE_SPEC } from "./helpers/stage-spec.js"

const FILE = "main.circuit.tsx"
let root: string
let client: Client

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}
const edit = (...edits: unknown[]) => call("edit_circuit", { file: FILE, edits })
const source = () => readFile(join(root, FILE), "utf8")

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-sheet-tools-"))
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  await call("new_circuit", { file: FILE, ...STAGE_SPEC })
})

describe("edit_circuit with sub-sheets", () => {
  test("add_instance places another use of a sheet with the next base, which checks with no errors", async () => {
    const answer = await edit({ add_instance: { sheet: "PowerStage", name: "PS3", connections: { VIN: "V1_8", VOUT: "V1_2", GND: "GND" } } })
    expect(answer).toMatchObject({ isError: false })
    expect(answer.text).toMatch(/^Change c0002 applied: 1 edit: add instance PS3 \(PowerStage\)/)
    expect(await source()).toContain(`<PowerStage name="PS3" connections={{ VIN: "V1_8", VOUT: "V1_2", GND: "GND" }} base={300} />`)
    expect((await call("check_circuit", { file: FILE })).text).toMatch(/^main\.circuit\.tsx: 0 errors/)
    expect((await call("circuit_summary", { file: FILE })).text).toContain("PS3 PowerStage base 300: VIN=V1_8 VOUT=V1_2 GND=GND, 3 parts")
  })

  test("add_instance refuses a port the sheet has not and a sheet that is not there; nothing is written", async () => {
    const before = await source()
    const port = await edit({ add_instance: { sheet: "PowerStage", name: "PS3", connections: { VCC: "X" } } })
    expect(port.text).toMatch(/^Edit 1 of 1 \(add_instance\) was refused: PowerStage has no port VCC; its ports are VIN, VOUT, GND/)
    const sheet = await edit({ set_props: { part: "J1", props: { schX: 1 } } }, { add_instance: { sheet: "Nope", name: "N1" } })
    expect(sheet.text).toMatch(/^Edit 2 of 2 \(add_instance\) was refused: There is no sheet Nope: Nope\.sheet\.tsx does not exist/)
    expect(await source()).toBe(before)
    expect(await listEntries(root, 10)).toHaveLength(1)
  })

  test("set_connections writes an instance's connections anew", async () => {
    const answer = await edit({ set_connections: { instance: "PS2", connections: { VIN: "VBUS", VOUT: "V2_5", GND: "GND" } } })
    expect(answer.text).toMatch(/set PS2 connections/)
    expect((await call("circuit_summary", { file: FILE })).text).toContain("PS2 PowerStage base 200: VIN=VBUS VOUT=V2_5 GND=GND, 3 parts")
    const wrong = await edit({ set_connections: { instance: "J1", connections: {} } })
    expect(wrong.text).toMatch(/was refused: J1 is not a sub-sheet instance/)
  })

  test("move_to_page moves a part or an instance and says what stays behind", async () => {
    await writeFile(
      join(root, "two.circuit.tsx"),
      `export default () => (\n  <board width="20mm" height="20mm">\n    <resistor name="R1" />\n    <resistor name="R2" />\n    <trace from="R1.pin1" to="R2.pin1" />\n    <trace from="R1.pin2" to="net.GND" />\n  </board>\n)\n`,
    )
    const answer = await call("edit_circuit", { file: "two.circuit.tsx", edits: [{ move_to_page: { part: "R1", page: "Power" } }] })
    expect(answer.text.split("\n")).toEqual([
      "Change c0002 applied: 1 edit: move R1 to page Power",
      "R1: R1.pin1 to R2.pin1 stays where it is written; it joins pins on two pages and is not drawn",
    ])
    const instance = await edit({ move_to_page: { part: "PS2", page: "Power" } })
    expect(instance.isError).toBe(false)
    expect(await source()).toMatch(/<page name="Power">\n\s+<PowerStage name="PS2"/)
  })
})

describe("check_circuit and circuit_summary for one instance", () => {
  beforeEach(async () => {
    await edit({ set_connections: { instance: "PS2", connections: { VIN: "V3_3", VOUT: "V1_8" } } })
  })

  test("check_circuit with an instance's name shows only the findings about its parts, nets and ports", async () => {
    const lines = (await call("check_circuit", { file: FILE, filter: "PS2" })).text.split("\n")
    expect(lines[0]).toMatch(/^main\.circuit\.tsx: 0 errors, \d+ warnings \(filter: PS2\)$/)
    expect(lines).toContain("warning unconnected-port [PS2.GND]: Port GND of PS2 (PowerStage) is not connected at main.circuit.tsx:6:5")
    expect(lines.some((line) => line.includes("[net.PS2/FB]"))).toBe(true)
    expect(lines.some((line) => /R101|PS1/.test(line) && !/R201|C201|U201/.test(line))).toBe(false)
  })

  test("circuit_summary with an instance's name shows its line, its parts and the nets they are on", async () => {
    const lines = (await call("circuit_summary", { file: FILE, filter: "PS2" })).text.split("\n")
    expect(lines).toEqual([
      "main.circuit.tsx, instance PS2: 3 parts, 4 nets",
      "PS2 PowerStage base 200: VIN=V3_3 VOUT=V1_8 GND=(open), 3 parts",
      "U201 chip in PS2 as U1",
      "C201 capacitor 1uF in PS2 as C1",
      "R201 resistor 10k in PS2 as R1",
      "GND: C101.pin2 C201.pin2 J1.pin2 U101.pin3 U201.pin3",
      "PS2/FB: R201.pin2",
      "V1_8: C201.pin1 R201.pin1 U201.pin2",
      "V3_3: C101.pin1 R101.pin1 U101.pin2 U201.pin1",
    ])
  })

  test("an unknown instance is refused, naming the instances", async () => {
    const answer = await call("circuit_summary", { file: FILE, filter: "PS9" })
    expect(answer).toEqual({ isError: true, text: "There is no instance PS9 in main.circuit.tsx; the instances are PS1, PS2" })
  })
})

describe("the guidance for a model", () => {
  test("the instructions and the skill say to put a repeated block in a sheet and to use pages for a large schematic", async () => {
    const skill = await readFile(new URL("../skills/copperflow/SKILL.md", import.meta.url), "utf8")
    for (const text of [client.getInstructions() ?? "", skill]) {
      expect(text).toMatch(/repeated block/)
      expect(text).toMatch(/instances/)
      expect(text).toMatch(/pages/)
    }
  })
})
