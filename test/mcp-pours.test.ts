import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises"
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
import { skillText } from "./helpers/skill-text.js"

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
const step = (edit: Record<string, unknown>) => call("edit_circuit", { file: FILE, edits: [edit] })
/** The second line of every refusal of a one-step edit_circuit call. */
const NOTHING = "No edits come before it, and nothing was written: the batch is all or nothing."
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

describe("edit_circuit's pour and hole steps", () => {
  test("are listed with their shapes", async () => {
    const { tools } = await client.listTools()
    const edits = (tools.find((t) => t.name === "edit_circuit")?.inputSchema.properties as Record<string, { items?: { properties?: Record<string, { properties?: object }> } }>).edits
    const shape = (name: string) => Object.keys(edits?.items?.properties?.[name]?.properties ?? {})
    expect(shape("add_pour")).toEqual(["net", "layer", "outline", "props"])
    expect(shape("remove_pour")).toEqual(["id"])
    expect(shape("add_hole")).toEqual(["x", "y", "diameter"])
    expect(shape("remove_hole")).toEqual(["id"])
  })

  test("add_pour writes one pour as one history entry and answers with its id and fill", async () => {
    const before = await entries()
    const result = await step({ add_pour: { net: "GND", layer: "bottom", props: { priority: 1, thermal: "solid" } } })
    expect(result.isError).toBe(false)
    expect(result.text).toMatch(/^Change c\d+ applied: 1 edit: add pour GND bottom\nWritten: copperpour:1\n/)
    expect(result.text).toMatch(/copperpour:1 GND bottom: \d+\.\d\d mm², joins \d+ pads/)
    expect(await entries()).toBe(before + 1)
    expect(await source()).toContain('<copperpour net="GND" layer="bottom" priority={1} thermal="solid" />')
  })

  test("add_pour writes the net's own name when given its id", async () => {
    const result = await step({ add_pour: { net: "net.GND", layer: "top" } })
    expect(result.isError).toBe(false)
    expect(result.text).toMatch(/copperpour:1 GND top: /)
    expect(await source()).toContain('<copperpour net="GND" layer="top" />')
  })

  test("add_pour takes an outline", async () => {
    const result = await step({ add_pour: { net: "GND", layer: "top", outline: SQUARE } })
    expect(result.isError).toBe(false)
    expect(await source()).toMatch(/<copperpour net="GND" layer="top" outline=\{\[/)
  })

  test("add_pour refuses an unknown net, a layer the board lacks, a bad prop and a crossed outline, writing nothing", async () => {
    const before = await source()
    const unknown = await step({ add_pour: { net: "NOPE", layer: "bottom" } })
    expect(unknown).toMatchObject({ isError: true })
    expect(unknown.text).toMatch(/no net NOPE/)
    const inner = await step({ add_pour: { net: "GND", layer: "inner1" } })
    expect(inner.text).toBe(`Edit 1 of 1 (add_pour) was refused: The board has 2 layers (top, bottom), so there is no inner1\n${NOTHING}`)
    const gap = await step({ add_pour: { net: "GND", layer: "bottom", props: { thermalGap: -1 } } })
    expect(gap.text).toMatch(/thermalGap must be a number of mm above 0/)
    const crossed = [SQUARE[0], SQUARE[2], SQUARE[1], SQUARE[3]]
    const bow = await step({ add_pour: { net: "GND", layer: "bottom", outline: crossed } })
    expect(bow.text).toMatch(/not a simple polygon/)
    expect(await source()).toBe(before)
  })

  test("remove_pour removes one by id as one entry; a locked pour is refused", async () => {
    await step({ add_pour: { net: "GND", layer: "bottom" } })
    await step({ add_pour: { net: "GND", layer: "top" } })
    await lock(["copperpour:2"])
    const refused = await step({ remove_pour: { id: "copperpour:2" } })
    expect(refused).toMatchObject({ isError: true })
    expect(refused.text).toMatch(/locked/)
    const before = await entries()
    const removed = await step({ remove_pour: { id: "copperpour:1" } })
    // Removing the first would hand its id to the locked second one.
    expect(removed.text).toMatch(/locked/)
    expect(await entries()).toBe(before)
  })

  test("a part lock never covers a pour", async () => {
    await step({ add_pour: { net: "GND", layer: "bottom" } })
    await lock(["J1", "U1", "C1"])
    const before = await entries()
    const removed = await step({ remove_pour: { id: "copperpour:1" } })
    expect(removed.isError).toBe(false)
    expect(removed.text).toMatch(/^Change c\d+ applied: 1 edit: remove copperpour:1$/)
    expect(await entries()).toBe(before + 1)
    expect(await source()).not.toContain("<copperpour")
  })

  test("add_hole and remove_hole, each one entry; an unknown id is refused", async () => {
    const before = await entries()
    const added = await step({ add_hole: { x: -12, y: 7, diameter: 2.2 } })
    expect(added.text).toMatch(/^Change c\d+ applied: 1 edit: add hole at \(-12, 7\)\nWritten: hole:1$/)
    expect(await source()).toContain("<hole x={-12} y={7} diameter={2.2} />")
    const missing = await step({ remove_hole: { id: "hole:2" } })
    expect(missing.text).toMatch(/No hole with id hole:2/)
    const removed = await step({ remove_hole: { id: "hole:1" } })
    expect(removed.text).toMatch(/1 edit: remove hole:1/)
    expect(await entries()).toBe(before + 2)
  })

  test("add_hole refuses a diameter of 0", async () => {
    const result = await step({ add_hole: { x: 0, y: 0, diameter: 0 } })
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

describe("circuit_summary view copper with pours and holes", () => {
  test("lists each pour with its net, layer, area and the pads it joins, and each hole", async () => {
    await call("edit_circuit", { file: FILE, edits: [{ add_pour: { net: "GND", layer: "bottom" } }, { add_hole: { x: -12, y: 7, diameter: 2.2 } }] })
    const { text } = await call("circuit_summary", { file: FILE, view: "copper" })
    expect(text).toMatch(/^Pours: 1, holes: 1$/m)
    expect(text).toMatch(/^copperpour:1 GND bottom: \d+\.\d\d mm², joins [1-9]\d* pads$/m)
    expect(text).toMatch(/^hole:1 at \(-12, 7\), 2\.2 mm$/m)
  })

  test("says nothing about pours on a board without any", async () => {
    const { text } = await call("circuit_summary", { file: FILE, view: "copper" })
    expect(text).not.toMatch(/Pours/)
  })
})

describe("check_circuit with pours and holes", () => {
  test("the copper filter takes copper-hole and the pour warnings", async () => {
    expect(COPPER_RULES.has("copper-hole")).toBe(true)
    for (const code of ["hole-off-board", "pour-floating", "pour-sparse", "pour-empty"]) expect(COPPER_RULES.has(code)).toBe(true)
    await step({ add_hole: { x: -4.5, y: 4, diameter: 1 } })
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

describe("the skill", () => {
  test("says a two-layer board gets a GND pour on both layers, checked by its joins, before autoroute, then check_circuit", async () => {
    {
      const text = await skillText()
      expect(text).toMatch(/a two-layer board gets a GND pour on both layers \(`top` and `bottom`\),\s+checked with the 'joins N pads' of `?circuit_summary`? `?view: "copper"`?/)
      expect(text).toMatch(/On a two-layer board pour GND on both layers \(`top` and `bottom`\) before `autoroute`/)
      expect(text).not.toMatch(/GND pour on the bottom/)
      expect(text).toMatch(/before `?autoroute`?[^]*?then `?check_circuit`?/)
      expect(text).toMatch(/`?pour-sparse`?/)
      expect(text).toMatch(/`?pour-empty`?/)
      for (const tool of ["add_pour", "remove_pour", "add_hole", "remove_hole"]) expect(text).toContain(tool)
      expect(text).toMatch(/A part's lock never covers a pour/)
    }
  })
})

describe("fix round 1", () => {
  const design = () => inProcessEngine.build(root, FILE)

  test("edit_circuit refuses a pour on a net the circuit does not have; a net made earlier in the batch is fine", async () => {
    const before = await source()
    const refused = await call("edit_circuit", { file: FILE, edits: [{ add_pour: { net: "NOPE", layer: "bottom" } }] })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/Edit 1 of 1 \(add_pour\) was refused: There is no net NOPE/)
    expect(await source()).toBe(before)
    const made = await call("edit_circuit", {
      file: FILE,
      edits: [{ place_part: { part: "resistor", name: "R9", props: { resistance: "1k", footprint: "0402" } } }, { connect: { from: "R9.pin1", to: "net.SHIELD" } }, { connect: { from: "R9.pin2", to: "net.GND" } }, { add_pour: { net: "SHIELD", layer: "top" } }],
    })
    expect(made.isError).toBe(false)
    expect((await design()).pcb.pours.map((pour) => pour.id)).toEqual(["copperpour:1"])
  })

  test("a pour naming a net the circuit lacks is a pour-net error in check_circuit's copper filter", async () => {
    await writeFile(join(root, FILE), (await source()).replace("<trace", '<copperpour net="NOPE" layer="bottom" />\n    <trace'))
    const { text } = await call("check_circuit", { file: FILE, filter: "copper" })
    expect(text).toMatch(/^error pour-net \[copperpour:1\]: copperpour:1 names the net NOPE, which the circuit does not have/m)
  })

  test("an outline point or a hole outside the board is refused and nothing is written", async () => {
    const before = await source()
    const outline = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 5 }]
    const pour = await step({ add_pour: { net: "GND", layer: "top", outline } })
    expect(pour.text).toBe(`Edit 1 of 1 (add_pour) was refused: outline point (100, 100) lies outside the board\n${NOTHING}`)
    const hole = await step({ add_hole: { x: 40, y: 0, diameter: 2 } })
    expect(hole.text).toBe(`Edit 1 of 1 (add_hole) was refused: the hole at (40, 0) lies outside the board\n${NOTHING}`)
    expect(await source()).toBe(before)
  })

  test("refusals name the step and say nothing was written", async () => {
    expect((await step({ remove_pour: { id: "copperpour:9" } })).text).toBe(`Edit 1 of 1 (remove_pour) was refused: No copper pour with id copperpour:9\n${NOTHING}`)
    expect((await step({ add_pour: { net: "NOPE", layer: "top" } })).text).toBe(`Edit 1 of 1 (add_pour) was refused: There is no net NOPE; connect pins to it first\n${NOTHING}`)
    expect((await step({ add_hole: { x: 0, y: 0, diameter: 0.05 } })).text).toBe(`Edit 1 of 1 (add_hole) was refused: diameter must be at least 0.1 mm\n${NOTHING}`)
    expect((await step({ add_pour: { net: "GND", layer: "top", props: { thermalGap: 20 } } })).text).toBe(`Edit 1 of 1 (add_pour) was refused: thermalGap must be a number of mm above 0 and at most 10\n${NOTHING}`)
  })

  test("the answered id is the one the built design gives the new pour or hole", async () => {
    // A pour in a group comes first in the file but the new pour still gets the next id.
    await writeFile(join(root, FILE), (await source()).replace("<trace", '<group><copperpour net="GND" layer="top" /><hole x={-12} y={-7} diameter={2} /></group>\n    <trace'))
    const pour = await step({ add_pour: { net: "VBUS", layer: "bottom" } })
    const pourId = /^Written: (copperpour:\d+)$/m.exec(pour.text)?.[1]
    const hole = await step({ add_hole: { x: 12, y: -7, diameter: 2 } })
    const holeId = /^Written: (hole:\d+)$/m.exec(hole.text)?.[1]
    const built = await design()
    expect(built.pcb.pours.find((one) => one.id === pourId)?.layer).toBe("bottom")
    expect(built.pcb.holes.find((one) => one.id === holeId)).toMatchObject({ x: 12, y: -7 })
    expect([pourId, holeId]).toEqual(["copperpour:2", "hole:2"])
  })
})
