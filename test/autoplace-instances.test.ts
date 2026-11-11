// autoplace with sub-sheet instances: an instance on a schematic page, and a sheet used twice placed as rigid copies.
import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { loadCircuit, updateAnnotations } from "../src/core/index.js"
import { lockParts } from "../src/core/annotations.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "two.circuit.tsx"
const SHEET = "Channel.sheet.tsx"
let root: string
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

const build = async (): Promise<Design> => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), FILE)
const overlaps = (design: Design) => design.violations.filter((v) => v.code === "courtyard-overlap")
const read = (file: string) => readFile(join(root, file), "utf8")
const lineOf = (text: string, name: string) => text.split("\n").find((l) => l.includes(`name="${name}"`))

const channel = {
  parts: [{ name: "R1", kind: "resistor", value: "1k", footprint: "0603" }, { name: "C1", kind: "capacitor", value: "100nF", footprint: "0603" }],
  nets: { IN: ["R1.pin1"], OUT: ["R1.pin2", "C1.pin1"], GND: ["C1.pin2"] },
  ports: ["IN", "OUT", "GND"],
}

function circuit(extra: Record<string, unknown> = {}) {
  return {
    file: FILE,
    place: false,
    board: { width: 40, height: 30 },
    sheets: { Channel: channel },
    instances: [
      { sheet: "Channel", name: "CH1", connections: { IN: "S1", OUT: "A1", GND: "GND" } },
      { sheet: "Channel", name: "CH2", connections: { IN: "S2", OUT: "A2", GND: "GND" } },
    ],
    parts: [{ name: "J1", kind: "pinheader", props: { pinCount: 5 } }],
    nets: { S1: ["J1.pin1"], S2: ["J1.pin2"], A1: ["J1.pin3"], A2: ["J1.pin4"], GND: ["J1.pin5"] },
    ...extra,
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-place-instances-"))
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

describe("a sheet used twice is placed as rigid copies", () => {
  test("autoplace on the whole board leaves no courtyard overlap and moves CH2 as a block in the same entry", async () => {
    await call("new_circuit", circuit())
    const answer = await call("autoplace", { file: FILE })
    expect(answer.text).toMatch(/^Placed 5 parts; .*; 0 overlaps$/m)
    expect(answer.text).toMatch(/CH2 was moved as a block, keeping the arrangement of CH1/)
    expect(overlaps(await build())).toEqual([])
    expect(lineOf(await read(FILE), "CH2")).toMatch(/pcbX=\{[-\d.]+\} pcbY=\{[-\d.]+\}/)
    expect((await call("undo_change", {})).isError).toBe(false)
    expect(lineOf(await read(FILE), "CH2")).not.toMatch(/pcbX/)
    expect(await read(SHEET)).not.toMatch(/pcbX/)
  })

  test("autoplace of CH2 after CH1 moves CH2's anchor and leaves CH1 and the sheet alone", async () => {
    await call("new_circuit", circuit())
    expect((await call("autoplace", { file: FILE, instance: "CH1" })).text).toMatch(/^Placed 2 parts/)
    expect(overlaps(await build()).length).toBeGreaterThan(0)
    const [main, sheet] = [await read(FILE), await read(SHEET)]
    const answer = await call("autoplace", { file: FILE, instance: "CH2" })
    expect(answer.text).toMatch(/^Placed 2 parts; .*; 0 overlaps$/m)
    expect(answer.text).toMatch(/CH2 was moved as a block/)
    expect(await read(SHEET)).toBe(sheet)
    const after = await read(FILE)
    expect(lineOf(after, "CH1")).toBe(lineOf(main, "CH1"))
    expect(lineOf(after, "CH2")).toMatch(/pcbX=/)
    expect(overlaps(await build())).toEqual([])
    expect((await call("autoplace", { file: FILE, instance: "CH2" })).text).toMatch(/^Nothing to place/)
  })

  test("a locked CH2 is left where it is and named", async () => {
    await call("new_circuit", circuit())
    const { model } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (a) => lockParts(a, model, ["CH2"], new Date().toISOString()))
    const before = await read(FILE)
    const answer = await call("autoplace", { file: FILE })
    expect(answer.text).toMatch(/CH2 is locked/)
    expect(answer.text).not.toMatch(/CH2 was moved/)
    expect(lineOf(await read(FILE), "CH2")).toBe(lineOf(before, "CH2"))
  })

  test("the same board placed twice gives the same files", async () => {
    await call("new_circuit", circuit())
    await call("autoplace", { file: FILE })
    const first = [await read(FILE), await read(SHEET)]
    await call("undo_change", {})
    await call("autoplace", { file: FILE })
    expect([await read(FILE), await read(SHEET)]).toEqual(first)
  })
})
