import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { lockParts } from "../src/core/annotations.js"
import { listEntries } from "../src/core/index.js"
import { loadCircuit, updateAnnotations } from "../src/core/workspace.js"
import { COPPER_RULES } from "../src/mcp/copper-summary.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "index.circuit.tsx"
const EXAMPLE = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
const NOW = "2026-11-11T10:00:00.000Z"
const SQUARE = [
  { x: -14, y: -8 },
  { x: 14, y: -8 },
  { x: 14, y: 8 },
  { x: -14, y: 8 },
]
let root: string
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

const entries = async () => (await listEntries(root, 100)).length
const source = () => readFile(join(root, FILE), "utf8")

async function lock(ids: string[]) {
  const { model } = await loadCircuit(root, FILE)
  await updateAnnotations(root, FILE, (a) => lockParts(a, model, ids, NOW))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-mcp-pours-"))
  await cp(EXAMPLE, root, { recursive: true })
  const server = createCopperflowServer(root, { engine: inProcessEngine })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

describe("the pour and hole tools", () => {
  test("are listed with their shapes", async () => {
    const { tools } = await client.listTools()
    const shape = (name: string) => Object.keys(tools.find((t) => t.name === name)?.inputSchema.properties ?? {})
    expect(shape("add_pour")).toEqual(["file", "net", "layer", "outline", "props"])
    expect(shape("remove_pour")).toEqual(["file", "id"])
    expect(shape("add_hole")).toEqual(["file", "x", "y", "diameter"])
    expect(shape("remove_hole")).toEqual(["file", "id"])
  })

  test("add_pour writes one pour as one history entry and answers with its id and fill", async () => {
    const before = await entries()
    const result = await call("add_pour", { file: FILE, net: "GND", layer: "bottom", props: { priority: 1, thermal: "solid" } })
    expect(result.isError).toBe(false)
    expect(result.text).toMatch(/^Change c\d+: added copperpour:1 \(GND, bottom\)/)
    expect(result.text).toMatch(/copperpour:1 GND bottom: \d+\.\d\d mm², joins \d+ pads/)
    expect(await entries()).toBe(before + 1)
    expect(await source()).toContain('<copperpour net="GND" layer="bottom" priority={1} thermal="solid" />')
  })

  test("add_pour takes an outline", async () => {
    const result = await call("add_pour", { file: FILE, net: "GND", layer: "top", outline: SQUARE })
    expect(result.isError).toBe(false)
    expect(await source()).toMatch(/<copperpour net="GND" layer="top" outline=\{\[/)
  })

  test("add_pour refuses an unknown net, a layer the board lacks, a bad prop and a crossed outline, writing nothing", async () => {
    const before = await source()
    const unknown = await call("add_pour", { file: FILE, net: "NOPE", layer: "bottom" })
    expect(unknown).toMatchObject({ isError: true })
    expect(unknown.text).toMatch(/no net NOPE/)
    const inner = await call("add_pour", { file: FILE, net: "GND", layer: "inner1" })
    expect(inner.text).toMatch(/2 layers/)
    const gap = await call("add_pour", { file: FILE, net: "GND", layer: "bottom", props: { thermalGap: -1 } })
    expect(gap.text).toMatch(/thermalGap must be a number of mm above 0/)
    const crossed = [SQUARE[0], SQUARE[2], SQUARE[1], SQUARE[3]]
    const bow = await call("add_pour", { file: FILE, net: "GND", layer: "bottom", outline: crossed })
    expect(bow.text).toMatch(/not a simple polygon/)
    expect(await source()).toBe(before)
  })

  test("remove_pour removes one by id as one entry; a locked pour is refused", async () => {
    await call("add_pour", { file: FILE, net: "GND", layer: "bottom" })
    await call("add_pour", { file: FILE, net: "GND", layer: "top" })
    await lock(["copperpour:2"])
    const refused = await call("remove_pour", { file: FILE, id: "copperpour:2" })
    expect(refused).toMatchObject({ isError: true })
    expect(refused.text).toMatch(/locked/)
    const before = await entries()
    const removed = await call("remove_pour", { file: FILE, id: "copperpour:1" })
    // Removing the first would hand its id to the locked second one.
    expect(removed.text).toMatch(/locked/)
    expect(await entries()).toBe(before)
  })

  test("a part lock never covers a pour", async () => {
    await call("add_pour", { file: FILE, net: "GND", layer: "bottom" })
    await lock(["J1", "U1", "C1"])
    const before = await entries()
    const removed = await call("remove_pour", { file: FILE, id: "copperpour:1" })
    expect(removed.isError).toBe(false)
    expect(removed.text).toMatch(/removed copperpour:1/)
    expect(await entries()).toBe(before + 1)
    expect(await source()).not.toContain("<copperpour")
  })

  test("add_hole and remove_hole, each one entry; an unknown id is refused", async () => {
    const before = await entries()
    const added = await call("add_hole", { file: FILE, x: -12, y: 7, diameter: 2.2 })
    expect(added.text).toMatch(/^Change c\d+: added hole:1 at \(-12, 7\), 2\.2 mm/)
    expect(await source()).toContain("<hole x={-12} y={7} diameter={2.2} />")
    const missing = await call("remove_hole", { file: FILE, id: "hole:2" })
    expect(missing.text).toMatch(/No hole with id hole:2/)
    const removed = await call("remove_hole", { file: FILE, id: "hole:1" })
    expect(removed.text).toMatch(/removed hole:1/)
    expect(await entries()).toBe(before + 2)
  })

  test("add_hole refuses a diameter of 0", async () => {
    const result = await call("add_hole", { file: FILE, x: 0, y: 0, diameter: 0 })
    expect(result.isError).toBe(true)
  })
})

describe("edit_circuit with pours and holes", () => {
  test("adds a pour and a hole and removes them in one entry", async () => {
    const before = await entries()
    const result = await call("edit_circuit", {
      file: FILE,
      edits: [{ add_pour: { net: "GND", layer: "bottom", props: { minWidth: 0.3 } } }, { add_hole: { x: 12, y: 7, diameter: 2 } }],
    })
    expect(result.isError).toBe(false)
    expect(result.text).toMatch(/add pour GND bottom; add hole at \(12, 7\)/)
    expect(await source()).toContain('<copperpour net="GND" layer="bottom" minWidth={0.3} />')
    expect(await entries()).toBe(before + 1)
    const removed = await call("edit_circuit", { file: FILE, edits: [{ remove_pour: { id: "copperpour:1" } }, { remove_hole: { id: "hole:1" } }] })
    expect(removed.isError).toBe(false)
    expect(await source()).not.toMatch(/<copperpour|<hole/)
  })

  test("a refused pour item writes nothing and names the item", async () => {
    const before = await source()
    const result = await call("edit_circuit", { file: FILE, edits: [{ add_hole: { x: 1, y: 1, diameter: 2 } }, { remove_pour: { id: "copperpour:4" } }] })
    expect(result.isError).toBe(true)
    expect(result.text).toMatch(/Edit 2 of 2 \(remove_pour\) was refused: No copper pour with id copperpour:4/)
    expect(await source()).toBe(before)
  })
})

describe("copper_summary with pours and holes", () => {
  test("lists each pour with its net, layer, area and the pads it joins, and each hole", async () => {
    await call("edit_circuit", { file: FILE, edits: [{ add_pour: { net: "GND", layer: "bottom" } }, { add_hole: { x: -12, y: 7, diameter: 2.2 } }] })
    const { text } = await call("copper_summary", { file: FILE })
    expect(text).toMatch(/^Pours: 1, holes: 1$/m)
    expect(text).toMatch(/^copperpour:1 GND bottom: \d+\.\d\d mm², joins [1-9]\d* pads$/m)
    expect(text).toMatch(/^hole:1 at \(-12, 7\), 2\.2 mm$/m)
  })

  test("says nothing about pours on a board without any", async () => {
    const { text } = await call("copper_summary", { file: FILE })
    expect(text).not.toMatch(/Pours/)
  })
})

describe("check_circuit with pours and holes", () => {
  test("the copper filter takes copper-hole and pour-floating", async () => {
    expect(COPPER_RULES.has("copper-hole")).toBe(true)
    expect(COPPER_RULES.has("pour-floating")).toBe(true)
    await call("add_hole", { file: FILE, x: -4.5, y: 4, diameter: 1 })
    const { text } = await call("check_circuit", { file: FILE, filter: "copper" })
    expect(text).toMatch(/^error copper-hole .*hole:1/m)
  })
})

describe("new_circuit with pours and holes", () => {
  const spec = {
    file: "pour.circuit.tsx",
    parts: [
      { name: "R1", kind: "resistor", value: "1k", footprint: "0402" },
      { name: "R2", kind: "resistor", value: "1k", footprint: "0402" },
    ],
    nets: { GND: ["R1.pin2", "R2.pin2"], SIG: ["R1.pin1", "R2.pin1"] },
  }

  test("takes pours and holes in its shape and writes them", async () => {
    const { tools } = await client.listTools()
    const properties = tools.find((t) => t.name === "new_circuit")?.inputSchema.properties ?? {}
    expect(Object.keys(properties)).toEqual(expect.arrayContaining(["pours", "holes"]))
    const result = await call("new_circuit", {
      ...spec,
      pours: [{ net: "GND", layer: "bottom" }, { net: "GND", layer: "top", props: { priority: 1 } }],
      holes: [{ x: 12, y: 7, diameter: 3.2 }],
    })
    expect(result.isError).toBe(false)
    expect(result.text).toMatch(/2 pours, 1 hole/)
    const text = await readFile(join(root, "pour.circuit.tsx"), "utf8")
    expect(text).toContain('<copperpour net="GND" layer="bottom" />')
    expect(text).toContain('<copperpour net="GND" layer="top" priority={1} />')
    expect(text).toContain("<hole x={12} y={7} diameter={3.2} />")
    expect((await call("check_circuit", { file: "pour.circuit.tsx", filter: "errors" })).text).toMatch(/0 errors/)
  })

  test("refuses a pour on a net it does not have, or on an inner layer", async () => {
    const unknown = await call("new_circuit", { ...spec, pours: [{ net: "VCC", layer: "bottom" }] })
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toMatch(/Pour 1: there is no net VCC/)
    const inner = await call("new_circuit", { ...spec, pours: [{ net: "GND", layer: "inner1" }] })
    expect(inner.isError).toBe(true)
    expect(inner.text).toMatch(/layer/)
    const gap = await call("new_circuit", { ...spec, pours: [{ net: "GND", layer: "top", props: { minWidth: 0 } }] })
    expect(gap.text).toMatch(/minWidth must be a number of mm above 0/)
  })
})

describe("the instructions and the skill", () => {
  test("say a two-layer board gets a GND pour on the bottom, and top when there is room, before autoroute, then check_circuit", async () => {
    const skill = await readFile(new URL("../skills/copperflow/SKILL.md", import.meta.url), "utf8")
    for (const text of [client.getInstructions() ?? "", skill.replace(/\s+/g, " ")]) {
      expect(text).toMatch(/two-layer board gets a GND pour on the bottom \(and on top when there is room\) before `?autoroute`?[^]*?then `?check_circuit`?/)
      for (const tool of ["add_pour", "remove_pour", "add_hole", "remove_hole"]) expect(text).toContain(tool)
      expect(text).toMatch(/A part's lock never covers a pour/)
    }
  })
})
