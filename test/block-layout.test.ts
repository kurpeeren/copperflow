// Laying out a board by its blocks: the eight-input board (one Input sheet used eight times, two 9-pin headers).
import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { boxOfPoints } from "../src/engine/pcb-place/geometry.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "io.circuit.tsx"
const CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8]
let root: string
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

const build = async (): Promise<Design> => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), FILE)

export const eightInputs = {
  file: FILE,
  place: false,
  sheets: {
    Input: {
      parts: [
        { name: "R1", kind: "resistor", value: "10k", footprint: "0603" },
        { name: "R2", kind: "resistor", value: "1.5k", footprint: "0603" },
        { name: "C1", kind: "capacitor", value: "100nF", footprint: "0603" },
        { name: "R3", kind: "resistor", value: "1k", footprint: "0603" },
      ],
      nets: { IN: ["R1.pin1"], DIV: ["R1.pin2", "R2.pin1", "R3.pin1"], OUT: ["R3.pin2", "C1.pin1"], GND: ["R2.pin2", "C1.pin2"] },
      ports: ["IN", "OUT", "GND"],
    },
  },
  instances: CHANNELS.map((n) => ({ sheet: "Input", name: `CH${n}`, connections: { IN: `IN${n}`, OUT: `DI${n}`, GND: "GND" } })),
  parts: [
    { name: "J1", kind: "pinheader", props: { pinCount: 9 } },
    { name: "J2", kind: "pinheader", props: { pinCount: 9 } },
  ],
  nets: {
    GND: ["J1.pin9", "J2.pin9"],
    ...Object.fromEntries(CHANNELS.map((n) => [`IN${n}`, [`J1.pin${n}`]])),
    ...Object.fromEntries(CHANNELS.map((n) => [`DI${n}`, [`J2.pin${n}`]])),
  },
}

/** Pairs of parts whose courtyards overlap, from the built board itself (not the checker's list). */
function overlapping(design: Design): string[] {
  const boxes = design.pcb.parts.map((p) => ({ name: p.component, box: boxOfPoints(p.courtyard) }))
  const pairs: string[] = []
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i]!.box, boxes[j]!.box]
      if (a.minX < b.maxX - 1e-6 && b.minX < a.maxX - 1e-6 && a.minY < b.maxY - 1e-6 && b.minY < a.maxY - 1e-6) pairs.push(`${boxes[i]!.name}/${boxes[j]!.name}`)
    }
  }
  return pairs
}

const outside = (design: Design) => design.violations.filter((v) => v.code === "board-edge")

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-block-layout-"))
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

describe("B1: no instance is placed on another", () => {
  test("whole-board autoplace without fit: no two courtyards overlap, an instance with no room is named", async () => {
    await call("new_circuit", eightInputs)
    const answer = await call("autoplace", { file: FILE })
    const design = await build()
    expect(overlapping(design)).toEqual([])
    // Every instance either has its own place on the board or is named as not placed.
    const named = /^Not placed: (.*)$/m.exec(answer.text)?.[1] ?? ""
    const board = boxOfPoints(design.pcb.board?.outline ?? [])
    for (const n of CHANNELS) {
      const off = design.pcb.parts.some((p) => {
        if (!new RegExp(`^[RC]${n}0\\d$`).test(p.component)) return false
        const b = boxOfPoints(p.courtyard)
        return b.minX < board.minX || b.maxX > board.maxX || b.minY < board.minY || b.maxY > board.maxY
      })
      if (off) expect(named).toContain(`CH${n} (`)
    }
  }, 120_000)

  test("whole-board autoplace with fit: the board grows until every instance fits, no overlap, nothing outside", async () => {
    await call("new_circuit", eightInputs)
    await call("autoplace", { file: FILE, instance: "CH1" })
    const answer = await call("autoplace", { file: FILE, fit: true })
    expect(answer.text).not.toMatch(/Not placed/)
    expect(answer.text).not.toMatch(/found no free room/)
    const design = await build()
    expect(overlapping(design)).toEqual([])
    expect(outside(design)).toEqual([])
  }, 120_000)
})
