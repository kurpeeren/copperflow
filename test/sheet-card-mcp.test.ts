import { beforeEach, expect, test } from "vitest"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { listHistory } from "../src/core/index.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

let root: string
let client: Client

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-card-"))
  const server = createCopperflowServer(root, { engine: inProcessEngine })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

const INPUT_SHEET = {
  does: "24 V digital input: divider, clamp, RC filter",
  sources: ["https://example.com/app-note.pdf"],
  parts: [
    { name: "R1", kind: "resistor", value: "10k", footprint: "0603" },
    { name: "R2", kind: "resistor", value: "1k", footprint: "0603" },
  ],
  nets: { IN: ["R1.pin1"], OUT: ["R1.pin2", "R2.pin1"], GND: ["R2.pin2"] },
  ports: [{ name: "IN", type: "input", carries: "0 to 24 V from the field" }, { name: "OUT", type: "output", carries: "3.3 V logic" }, "GND"],
}

async function writeBoard() {
  const made = await call("new_circuit", {
    file: "main.circuit.tsx",
    parts: [{ name: "J1", kind: "pinheader", props: { pinCount: 3 } }],
    nets: { IN1: ["J1.pin1"], DI1: ["J1.pin2"], GND: ["J1.pin3"] },
    sheets: { Input: INPUT_SHEET },
    instances: [{ sheet: "Input", name: "CH1", connections: { IN: "IN1", OUT: "DI1", GND: "GND" } }],
    place: false,
  })
  expect(made.isError, made.text).toBe(false)
}

test("new_circuit writes a sheet's card into its file", async () => {
  await writeBoard()
  const text = await readFile(join(root, "Input.sheet.tsx"), "utf8")
  expect(text).toContain('<sheet does="24 V digital input: divider, clamp, RC filter" sources={["https://example.com/app-note.pdf"]}>')
  expect(text).toContain('<port name="IN" type="input" carries="0 to 24 V from the field" />')
  expect(text).toContain('<port name="GND" />')
})

test("new_circuit refuses a card that is too long or a port type there is not", async () => {
  const long = await call("new_circuit", {
    file: "a.circuit.tsx",
    parts: [],
    nets: {},
    sheets: { Input: { ...INPUT_SHEET, does: "x".repeat(161) } },
    instances: [{ sheet: "Input", name: "CH1", connections: {} }],
    place: false,
  })
  expect(long).toMatchObject({ isError: true })
  expect(long.text).toContain("160")
})

test("circuit_summary on a sheet file and on an instance shows the card", async () => {
  await writeBoard()
  const sheet = await call("circuit_summary", { file: "Input.sheet.tsx" })
  expect(sheet.text).toContain("Does: 24 V digital input: divider, clamp, RC filter")
  expect(sheet.text).toContain("Sources: https://example.com/app-note.pdf")
  expect(sheet.text).toContain("  port IN (input, 0 to 24 V from the field)")
  expect(sheet.text).toContain("  port GND")
  const instance = await call("circuit_summary", { file: "main.circuit.tsx", filter: "CH1" })
  expect(instance.text).toContain("Does: 24 V digital input: divider, clamp, RC filter")
  expect(instance.text).toContain("  port OUT (output, 3.3 V logic)")
})

test("describe_sheet writes the card as one history entry and refuses a name that is not a port", async () => {
  await writeBoard()
  const before = (await listHistory(root, 50)).entries.length
  const done = await call("describe_sheet", {
    file: "Input.sheet.tsx",
    does: "Field input, 24 V to 3.3 V",
    sources: ["Datasheet A", "https://example.com/b"],
    ports: { GND: { type: "ground" }, OUT: { carries: "3.3 V, 1 mA at most" } },
  })
  expect(done.isError, done.text).toBe(false)
  expect((await listHistory(root, 50)).entries.length).toBe(before + 1)
  const text = await readFile(join(root, "Input.sheet.tsx"), "utf8")
  expect(text).toContain('does="Field input, 24 V to 3.3 V" sources={["Datasheet A","https://example.com/b"]}')
  expect(text).toContain('<port name="GND" type="ground" />')
  expect(text).toContain('<port name="OUT" type="output" carries="3.3 V, 1 mA at most" />')
  const wrong = await call("describe_sheet", { file: "Input.sheet.tsx", ports: { VIN: { type: "power_in" } } })
  expect(wrong.isError).toBe(true)
  expect(wrong.text).toContain("VIN is not a port of this sheet; its ports are IN, OUT, GND")
  expect((await listHistory(root, 50)).entries.length).toBe(before + 1)
})
