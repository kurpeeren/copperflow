import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { listCircuits, listEntries, loadCircuit, redoChange, undoChange, updateAnnotations } from "../src/core/index.js"
import { lockParts } from "../src/core/annotations.js"
import { BOARD } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { DEMO } from "./helpers/new-circuit-demo.js"
import { skillText } from "./helpers/skill-text.js"

const EXAMPLE = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
const FILE = DEMO.file
let root: string
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  // These tests are about the file new_circuit writes; placing it is tested in new-circuit-place.test.ts.
  const result = await client.callTool({ name, arguments: name === "new_circuit" ? { place: false, ...args } : args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

const exists = (file: string) => stat(join(root, file)).then(() => true, () => false)

const TRACES = Object.values(DEMO.nets).reduce((sum, pins) => sum + pins.length, 0)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-newc-"))
  await cp(EXAMPLE, root, { recursive: true })
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

describe("new_circuit", () => {
  test("writes the demo netlist as a file that builds without errors", async () => {
    const answer = await call("new_circuit", DEMO)
    expect(answer.isError).toBe(false)
    expect(answer.text.split("\n")).toEqual([
      "Change c0001: wrote rebuilt.circuit.tsx",
      "9 parts",
      `6 nets, ${TRACES} traces`,
      "Now call check_circuit once.",
    ])
    const check = (await call("check_circuit", { file: FILE, filter: "errors" })).text
    expect(check.split("\n")[0]).toMatch(/: 0 errors/)
  })

  test("the file has the imports, a board, parts without positions and one trace per pin", async () => {
    await call("new_circuit", DEMO)
    const text = await readFile(join(root, FILE), "utf8")
    expect(text).toContain('import { TYPE_C_6P } from "./parts/TYPE-C-6P/TYPE_C_6P"')
    expect(text).toContain('import { AP2112K_3_3 } from "./parts/AP2112K-3.3/AP2112K_3_3"')
    expect(text).toContain('<board width="30mm" height="18mm">')
    expect(text).toContain('<resistor name="R1" resistance="5.1k" footprint="0402" />')
    expect(text).toContain('<led name="LED1" color="red" footprint="0603" pinLabels={{ pin1: "cathode", pin2: "anode" }} />')
    expect(text).toContain('<trace from="J1.VBUS1" to="net.VBUS" />')
    expect(text).toContain('<trace from="LED1.anode" to="net.LED_A" />')
    expect(text.match(/<trace /g)).toHaveLength(TRACES)
    expect(text).not.toMatch(/schX|pcbX|schematicRouteHints/)
    expect(text.indexOf("<trace ")).toBeGreaterThan(text.indexOf('name="J2"'))
  })

  test("the board is 30 by 20 mm when none is given", async () => {
    await call("new_circuit", { file: "a.circuit.tsx", parts: [{ name: "R1", kind: "resistor" }], nets: { GND: ["R1.pin1"] } })
    expect(await readFile(join(root, "a.circuit.tsx"), "utf8")).toContain('<board width="30mm" height="20mm">')
  })

  test("a bad pin is refused with the part's real pin names and nothing is written", async () => {
    const answer = await call("new_circuit", { ...DEMO, nets: { ...DEMO.nets, GND: ["U1.GROUND"] } })
    expect(answer.isError).toBe(true)
    expect(answer.text).toContain("U1.GROUND")
    expect(answer.text).toContain("VIN/pin1")
    expect(answer.text).toContain("VOUT/pin5")
    expect(await exists(FILE)).toBe(false)
    expect(await listEntries(root, 10)).toHaveLength(0)
  })

  test("a built-in part lists its pin names in the refusal", async () => {
    const answer = await call("new_circuit", { file: "a.circuit.tsx", parts: [{ name: "R1", kind: "resistor" }], nets: { GND: ["R1.pin3"] } })
    expect(answer.text).toContain("pin1/left, pin2/right")
  })

  const one = [{ name: "R1", kind: "resistor" }]
  test.each([
    ["an unknown kind", { parts: [{ name: "X1", kind: "flux_capacitor" }], nets: {} }, /unknown kind "flux_capacitor"/],
    ["an unknown library id", { parts: [{ name: "U1", part: "nope" }], nets: {} }, /Unknown part "nope"/],
    ["both kind and part", { parts: [{ name: "U1", kind: "resistor", part: "TYPE-C-6P" }], nets: {} }, /exactly one of kind/],
    ["neither kind nor part", { parts: [{ name: "U1" }], nets: {} }, /exactly one of kind/],
    ["a duplicate name", { parts: [...one, ...one], nets: {} }, /Two parts are named R1/],
    ["a bad name", { parts: [{ name: "1R", kind: "resistor" }], nets: {} }, /not a valid part name/],
    ["a bad net name", { parts: one, nets: { "a b": ["R1.pin1"] } }, /not a net name/],
    ["a pin of a missing part", { parts: one, nets: { GND: ["R9.pin1"] } }, /no part R9/],
    ["a malformed pin", { parts: one, nets: { GND: ["R1"] } }, /not a pin selector/],
    ["a footprint on a library part", { parts: [{ name: "U1", part: "AP2112K-3.3", footprint: "0402" }], nets: {} }, /comes from parts\/AP2112K-3.3/],
    ["a value on a part without one", { parts: [{ name: "D1", kind: "led", value: "red" }], nets: {} }, /has no value/],
    ["a value twice", { parts: [{ name: "R1", kind: "resistor", value: "1k", props: { resistance: "2k" } }], nets: {} }, /both set resistance/],
    ["no parts", { parts: [], nets: {} }, /too_small|at least|>=1/i],
    ["a huge board", { parts: one, nets: {}, board: { width: 5000, height: 10 } }, /Board width/],
    ["a pin header without pins", { parts: [{ name: "J1", kind: "pinheader" }], nets: { A: ["J1.pin1"] } }, /pinCount/],
  ])("refuses %s", async (_label, input, message) => {
    const answer = await call("new_circuit", { file: "x.circuit.tsx", ...input })
    expect(answer.isError).toBe(true)
    expect(answer.text).toMatch(message)
    expect(await exists("x.circuit.tsx")).toBe(false)
  })

  test("a pin on two nets is refused, also under two spellings", async () => {
    const file = "x.circuit.tsx"
    expect((await call("new_circuit", { file, parts: one, nets: { A: ["R1.pin1"], B: ["R1.pin1"] } })).text).toMatch(/R1\.pin1 is on both A and B/)
    expect((await call("new_circuit", { file, parts: one, nets: { A: ["R1.pin1"], B: ["R1.left"] } })).text).toMatch(/on both A and B/)
  })

  test("a pin repeated on the same net is written once", async () => {
    await call("new_circuit", { file: "x.circuit.tsx", parts: one, nets: { A: ["R1.pin1", "R1.left"] } })
    expect((await readFile(join(root, "x.circuit.tsx"), "utf8")).match(/<trace /g)).toHaveLength(1)
  })

  test("file names must end in .circuit.tsx and stay inside the project", async () => {
    expect((await call("new_circuit", { file: "a.tsx", parts: one, nets: {} })).text).toMatch(/\.circuit\.tsx/)
    expect((await call("new_circuit", { file: "../out.circuit.tsx", parts: one, nets: {} })).text).toMatch(/outside the project/)
  })

  test("a file in a new folder is created and listed", async () => {
    await call("new_circuit", { file: "boards/b.circuit.tsx", parts: one, nets: {} })
    expect(await listCircuits(root)).toContain("boards/b.circuit.tsx")
  })
})

describe("new_circuit history and replace", () => {
  const input = { file: "a.circuit.tsx", parts: [{ name: "R1", kind: "resistor" }], nets: { GND: ["R1.pin1"] } }

  test("is one history entry; undo removes the file and redo brings it back", async () => {
    await call("new_circuit", input)
    expect(await listEntries(root, 10)).toHaveLength(1)
    const text = await readFile(join(root, "a.circuit.tsx"), "utf8")
    await undoChange(root, { author: "ai" })
    expect(await exists("a.circuit.tsx")).toBe(false)
    expect(await listCircuits(root)).not.toContain("a.circuit.tsx")
    await redoChange(root, { author: "ai" })
    expect(await readFile(join(root, "a.circuit.tsx"), "utf8")).toBe(text)
    await undoChange(root, { author: "ai" })
    expect(await exists("a.circuit.tsx")).toBe(false)
  })

  test("an existing file is refused without replace and left alone", async () => {
    await writeFile(join(root, "a.circuit.tsx"), BOARD)
    const answer = await call("new_circuit", input)
    expect(answer.isError).toBe(true)
    expect(answer.text).toMatch(/already exists.*replace: true/)
    expect(await readFile(join(root, "a.circuit.tsx"), "utf8")).toBe(BOARD)
    expect(await listEntries(root, 10)).toHaveLength(0)
  })

  test("replace overwrites, and undo restores the old file", async () => {
    await writeFile(join(root, "a.circuit.tsx"), BOARD)
    const answer = await call("new_circuit", { ...input, replace: true })
    expect(answer.isError).toBe(false)
    expect(await readFile(join(root, "a.circuit.tsx"), "utf8")).not.toBe(BOARD)
    await undoChange(root, { author: "ai" })
    expect(await readFile(join(root, "a.circuit.tsx"), "utf8")).toBe(BOARD)
  })

  test("replace is refused while the file has a locked part", async () => {
    await writeFile(join(root, "a.circuit.tsx"), BOARD)
    const { model } = await loadCircuit(root, "a.circuit.tsx")
    await updateAnnotations(root, "a.circuit.tsx", (a) => lockParts(a, model, ["R1"], "2026-11-09T10:00:00.000Z"))
    const answer = await call("new_circuit", { ...input, replace: true })
    expect(answer.isError).toBe(true)
    expect(answer.text).toMatch(/locked part \(R1\)/)
    expect(await readFile(join(root, "a.circuit.tsx"), "utf8")).toBe(BOARD)
  })

  test("undo of a created file is refused once the file changed", async () => {
    await call("new_circuit", input)
    await call("edit_circuit", { file: "a.circuit.tsx", edits: [{ set_props: { part: "R1", props: { resistance: "1k" } } }] })
    await expect(undoChange(root, { author: "ai", id: "c0001" })).rejects.toThrow(/has changed since c0001/)
  })

  test("the tool list and the skill name new_circuit", async () => {
    expect((await client.listTools()).tools.map((t) => t.name)).toContain("new_circuit")
    expect(await skillText()).toContain("new_circuit")
  })
})
