import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { createPart, generateCircuit, listEntries, redoChange, undoChange, updateAnnotations } from "../src/core/index.js"
import { addMark } from "../src/core/annotations.js"
import { BOARD } from "./fixtures.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { DEMO } from "./helpers/new-circuit-demo.js"

const EXAMPLE = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
let root: string
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  // These tests are about the file new_circuit writes; placing it is tested in new-circuit-place.test.ts.
  const result = await client.callTool({ name, arguments: name === "new_circuit" ? { place: false, ...args } : args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

const exists = (file: string) => stat(join(root, file)).then(() => true, () => false)
const errorsLine = async (file: string) => (await call("check_circuit", { file, filter: "errors" })).text.split("\n")[0]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-newc2-"))
  await cp(EXAMPLE, root, { recursive: true })
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

/** The pins that share a net, as sorted groups: the connectivity of a design without net names. */
async function connectivity(file: string): Promise<string[]> {
  const { circuit } = await inProcessEngine.build(root, file)
  return circuit.nets.map((net) => [...net.pins].sort().join(" ")).filter((group) => group.includes(" ")).sort()
}

describe("new_circuit round trip and pins", () => {
  test("the demo netlist has the connectivity of the demo circuit", async () => {
    await call("new_circuit", DEMO)
    const demo = await connectivity("index.circuit.tsx")
    expect(demo.length).toBeGreaterThan(5)
    expect(await connectivity(DEMO.file)).toEqual(demo)
  })

  test("pinLabels rename the pins that nets are checked against", async () => {
    const part = { name: "D1", kind: "led", props: { pinLabels: { pin1: "cathode", pin2: "anode" } } }
    const bad = await call("new_circuit", { file: "x.circuit.tsx", parts: [part], nets: { A: ["D1.pos"] } })
    expect(bad.text).toContain("pin1/cathode, pin2/anode")
    const good = await call("new_circuit", { file: "x.circuit.tsx", parts: [part], nets: { A: ["D1.anode"] } })
    expect(good.isError).toBe(false)
  })

  test("pinLabels are refused for a library part, with a bad key or name, or as another prop", async () => {
    const run = (part: object) => call("new_circuit", { file: "x.circuit.tsx", parts: [part], nets: {} })
    expect((await run({ name: "U1", part: "AP2112K-3.3", props: { pinLabels: { pin1: "A" } } })).text).toMatch(/change them there/)
    expect((await run({ name: "D1", kind: "led", props: { pinLabels: { left: "A" } } })).text).toMatch(/pin1, pin2/)
    expect((await run({ name: "D1", kind: "led", props: { pinLabels: { pin1: "a b" } } })).text).toMatch(/letters, digits and _/)
    expect((await run({ name: "D1", kind: "led", props: { other: { pin1: "A" } } })).text).toMatch(/only pinLabels takes an object/)
  })

  test("a chip gets its pins from the footprint's pads, from pinCount or from pinLabels", async () => {
    const parts = [
      { name: "U1", kind: "chip", footprint: "soic8" },
      { name: "U2", kind: "chip", props: { pinLabels: { pin1: "VIN", pin2: "GND" } } },
      { name: "J1", kind: "connector", props: { pinCount: 3 } },
    ]
    const answer = await call("new_circuit", { file: "x.circuit.tsx", parts, nets: { A: ["U1.pin8", "U2.VIN", "J1.pin3"] } })
    expect(answer.isError).toBe(false)
    expect(await errorsLine("x.circuit.tsx")).toMatch(/: 0 errors/)
    const none = await call("new_circuit", { file: "y.circuit.tsx", parts: [{ name: "U1", kind: "chip" }], nets: { A: ["U1.pin1"] } })
    expect(none.text).toMatch(/pinCount/)
    const past = await call("new_circuit", { file: "y.circuit.tsx", parts: [{ name: "J1", kind: "connector", props: { pinCount: 3 } }], nets: { A: ["J1.pin4"] } })
    expect(past.text).toContain("pin1, pin2, pin3")
  })

  test("a library part with two pins of one name is refused for that name", async () => {
    const part = { title: "Dual", footprint: "soic8", pins: { "1": { name: "A", type: "passive" }, "2": { name: "A", type: "passive" } } }
    await createPart(root, "Dual", part, { now: "2026-11-09T10:00:00.000Z" })
    const parts = [{ name: "U1", part: "Dual" }]
    expect((await call("new_circuit", { file: "x.circuit.tsx", parts, nets: { N: ["U1.A"] } })).text).toMatch(/several pins named A \(pin1, pin2\); write pin<n>/)
    expect((await call("new_circuit", { file: "x.circuit.tsx", parts, nets: { N: ["U1.pin2"] } })).isError).toBe(false)
  })

  test("a circuit needs a part, also below the tool's schema", async () => {
    await expect(generateCircuit(root, "a.circuit.tsx", { parts: [], nets: {} })).rejects.toThrow(/at least one part/)
  })
})

describe("new_circuit file names and folders", () => {
  const parts = [{ name: "J1", part: "TYPE-C-6P" }]
  const importOf = async (file: string) => (await readFile(join(root, file), "utf8")).match(/from "(.*TYPE_C_6P)"/)?.[1]

  test("a library part in a subfolder file imports from the parent folder and builds", async () => {
    await call("new_circuit", { file: "boards/b.circuit.tsx", parts, nets: { G: ["J1.GND1", "J1.GND2", "J1.EH"] } })
    expect(await importOf("boards/b.circuit.tsx")).toBe("../parts/TYPE-C-6P/TYPE_C_6P")
    expect(await errorsLine("boards/b.circuit.tsx")).toMatch(/: 0 errors/)
  })

  test("a backslash or an absolute file name means the same project file", async () => {
    await call("new_circuit", { file: "boards\\c.circuit.tsx", parts, nets: {} })
    expect(await importOf("boards/c.circuit.tsx")).toBe("../parts/TYPE-C-6P/TYPE_C_6P")
    const answer = await call("new_circuit", { file: join(root, "abs.circuit.tsx"), parts, nets: {} })
    expect(answer.text).toContain("wrote abs.circuit.tsx")
    expect(await importOf("abs.circuit.tsx")).toBe("./parts/TYPE-C-6P/TYPE_C_6P")
    expect((await listEntries(root, 10)).map((e) => e.file).sort()).toEqual(["abs.circuit.tsx", "boards/c.circuit.tsx"])
  })

  test("a folder that links outside the project is refused and nothing is created there", async () => {
    const outside = await mkdtemp(join(tmpdir(), "cf-out-"))
    await symlink(outside, join(root, "link"), "junction")
    const answer = await call("new_circuit", { file: "link/sub/x.circuit.tsx", parts, nets: {} })
    expect(answer.isError).toBe(true)
    expect(answer.text).toMatch(/outside the project/)
    expect(await stat(join(outside, "sub")).then(() => true, () => false)).toBe(false)
    expect(await listEntries(root, 10)).toHaveLength(0)
  })

  test("a refused netlist leaves no folder behind", async () => {
    await call("new_circuit", { file: "fresh/deep/x.circuit.tsx", parts, nets: { G: ["J1.nope"] } })
    expect(await exists("fresh")).toBe(false)
  })

  test("the history names the file as the folder is spelled on disk", async () => {
    await mkdir(join(root, "boards"))
    if (!(await exists("Boards"))) return // a case-sensitive disk keeps them apart
    await call("new_circuit", { file: "Boards/d.circuit.tsx", parts, nets: {} })
    expect((await listEntries(root, 1))[0]?.file).toBe("boards/d.circuit.tsx")
  })
})

describe("new_circuit undo, redo and leftovers", () => {
  const input = { file: "a.circuit.tsx", parts: [{ name: "R1", kind: "resistor" }], nets: { GND: ["R1.pin1"] } }

  test("replace, undo, redo gives the new text again", async () => {
    await writeFile(join(root, "a.circuit.tsx"), BOARD)
    await call("new_circuit", { ...input, replace: true })
    const replaced = await readFile(join(root, "a.circuit.tsx"), "utf8")
    await undoChange(root, { author: "ai" })
    await redoChange(root, { author: "ai" })
    expect(await readFile(join(root, "a.circuit.tsx"), "utf8")).toBe(replaced)
  })

  test("undoing a redone creation reads as an undo of the creation", async () => {
    await call("new_circuit", input)
    await undoChange(root, { author: "ai" })
    await redoChange(root, { author: "ai" })
    await undoChange(root, { author: "ai" })
    const [last] = await listEntries(root, 1)
    expect(last?.summary).toMatch(/^Undo: create a\.circuit\.tsx/)
  })

  test("marks left from an earlier file of this name are mentioned", async () => {
    await call("new_circuit", input)
    await updateAnnotations(root, "a.circuit.tsx", (a) => addMark(a, { text: "check", view: "pcb", x: 1, y: 1 }, "2026-11-09T10:00:00.000Z").annotations)
    await undoChange(root, { author: "ai" })
    const answer = await call("new_circuit", input)
    expect(answer.text).toContain("1 marks and 0 locks from an earlier a.circuit.tsx")
    expect(answer.text.split("\n").at(-1)).toBe("Now call check_circuit once.")
  })
})
