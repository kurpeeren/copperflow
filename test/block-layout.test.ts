// Laying out a board by its blocks: the eight-input board (one Input sheet used eight times, two 9-pin headers).
import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile } from "node:fs/promises"
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

/** The parts of instance CHn: R n01..R n03 and C n01. */
const partsOf = (design: Design, n: number) => design.pcb.parts.filter((p) => new RegExp(`^[RC]${n}0\\d$`).test(p.component))

/** The longest edge of each net's shortest tree over the given parts' pads, for nets two of them share. */
function innerLinks(parts: Design["pcb"]["parts"]): number[] {
  const byNet = new Map<string, { x: number; y: number; part: string }[]>()
  for (const part of parts) for (const pad of part.pads) if (pad.net) byNet.set(pad.net, [...(byNet.get(pad.net) ?? []), { x: pad.x, y: pad.y, part: part.component }])
  const longest: number[] = []
  for (const pads of byNet.values()) {
    if (new Set(pads.map((p) => p.part)).size < 2) continue
    const inTree = [pads[0]!]
    const rest = pads.slice(1)
    let worst = 0
    while (rest.length > 0) {
      let best = { k: 0, d: Infinity }
      rest.forEach((p, k) => {
        for (const q of inTree) {
          const d = Math.hypot(p.x - q.x, p.y - q.y)
          if (d < best.d) best = { k, d }
        }
      })
      worst = Math.max(worst, best.d)
      inTree.push(...rest.splice(best.k, 1))
    }
    longest.push(worst)
  }
  return longest
}

describe("B2: a block is packed tight", () => {
  test("autoplace { instance: CH1 } packs the four parts on their own, the inner connections short", async () => {
    await call("new_circuit", eightInputs)
    expect((await call("autoplace", { file: FILE, instance: "CH1" })).text).toMatch(/^Placed 4 parts/)
    const parts = partsOf(await build(), 1)
    expect(parts).toHaveLength(4)
    const boxes = parts.map((p) => boxOfPoints(p.courtyard))
    const area = boxes.reduce((s, b) => s + (b.maxX - b.minX) * (b.maxY - b.minY), 0)
    const all = boxOfPoints(boxes.flatMap((b) => [{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]))
    expect((all.maxX - all.minX) * (all.maxY - all.minY)).toBeLessThanOrEqual(2.0 * area)
    for (const d of innerLinks(parts)) expect(d).toBeLessThanOrEqual(3)
  }, 120_000)
})

/** How many tracks a net has: by the net the record names, since copper on copies stacked on each other resolves to none. */
const tracksOn = (design: Design, net: string) => design.pcb.tracks.filter((t) => [t.net, t.named].some((one) => one === net || one === `net.${net}`)).length

describe("B3: a block is routed on its own", () => {
  test("autoroute { instance: CH1 } right after placing it routes all its inner connections", async () => {
    await call("new_circuit", eightInputs)
    await call("autoplace", { file: FILE, instance: "CH1" })
    const answer = await call("autoroute", { file: FILE, instance: "CH1" })
    expect(answer.text).toMatch(/Routed 4 of 4 connections/)
    const design = await build()
    expect(tracksOn(design, "CH1/DIV")).toBeGreaterThan(0)
    // The copies stacked on CH1 (no place of their own yet) got no copper on top of CH1's.
    expect(tracksOn(design, "CH2/DIV")).toBe(0)
  }, 120_000)

  test("the route still copies to another instance placed the same way", async () => {
    await call("new_circuit", eightInputs)
    await call("autoplace", { file: FILE, instance: "CH1" })
    await call("set_props", { file: FILE, part: "CH2", props: { pcbX: 8, pcbY: 0 } })
    const answer = await call("autoroute", { file: FILE, instance: "CH1" })
    expect(answer.text).toMatch(/Routed 8 of 8 connections/)
    expect(tracksOn(await build(), "CH2/DIV")).toBeGreaterThan(0)
  }, 120_000)
})

/** The ratsnest lines (unrouted connections) of a net. */
const openOn = (design: Design, net: string) => design.pcb.ratsnest.filter((line) => line.net === net || line.net === `net.${net}`).length

/** Whether every point of the net's tracks lies inside the bounds of the instance's courtyards (0.05 mm slack). */
function copperInside(design: Design, net: string, n: number): boolean {
  const all = boxOfPoints(partsOf(design, n).flatMap((p) => p.courtyard))
  const tracks = design.pcb.tracks.filter((t) => [t.net, t.named].some((one) => one === net || one === `net.${net}`))
  return tracks.length > 0 && tracks.every((t) => t.points.every((p) => p.x >= all.minX - 0.05 && p.x <= all.maxX + 0.05 && p.y >= all.minY - 0.05 && p.y <= all.maxY + 0.05))
}

describe("B4: a block is one thing on the board", () => {
  test("set_props moving and turning an instance carries its inner copper", async () => {
    await call("new_circuit", eightInputs)
    await call("autoplace", { file: FILE, instance: "CH1" })
    await call("set_props", { file: FILE, part: "CH2", props: { pcbX: 8, pcbY: 0 } })
    await call("autoroute", { file: FILE, instance: "CH1" })
    expect(openOn(await build(), "CH2/DIV")).toBe(0)
    const answer = await call("set_props", { file: FILE, part: "CH2", props: { pcbX: 9, pcbY: 9, pcbRotation: 90 } })
    expect(answer.text).toMatch(/^Copper: .* went with CH2/m)
    const design = await build()
    expect(openOn(design, "CH2/DIV")).toBe(0)
    expect(copperInside(design, "CH2/DIV", 2)).toBe(true)
    expect((await call("undo_change", {})).isError).toBe(false)
    expect(copperInside(await build(), "CH2/DIV", 2)).toBe(true)
  }, 120_000)

  test("copper that leaves the block is removed by the move and shows as unrouted again", async () => {
    await call("new_circuit", eightInputs)
    await call("autoplace", { file: FILE, instance: "CH1" })
    await call("autoplace", { file: FILE, fit: true })
    expect((await call("autoroute", { file: FILE, nets: ["IN2"] })).text).toMatch(/Routed 1 of 1/)
    expect(tracksOn(await build(), "IN2")).toBeGreaterThan(0)
    const answer = await call("set_props", { file: FILE, part: "CH2", props: { pcbX: 40, pcbY: 40 } })
    expect(answer.text).toMatch(/removed \(now unrouted\)/)
    const design = await build()
    expect(tracksOn(design, "IN2")).toBe(0)
    expect(openOn(design, "IN2")).toBe(1)
  }, 120_000)

  test("copies moved off the instance they sat on by the placer take a copy of its inner copper", async () => {
    await call("new_circuit", eightInputs)
    await call("autoplace", { file: FILE, instance: "CH1" })
    await call("autoroute", { file: FILE, instance: "CH1" })
    await call("autoplace", { file: FILE, fit: true })
    const design = await build()
    for (const n of CHANNELS) {
      expect(openOn(design, `CH${n}/DIV`)).toBe(0)
      expect(copperInside(design, `CH${n}/DIV`, n)).toBe(true)
    }
  }, 120_000)
})

/** How far a part's courtyard is from the nearest board edge, in mm. */
function edgeGap(design: Design, name: string): number {
  const board = boxOfPoints(design.pcb.board?.outline ?? [])
  const part = design.pcb.parts.find((p) => p.component === name)
  const b = boxOfPoints(part?.courtyard ?? [])
  return Math.min(b.minX - board.minX, board.maxX - b.maxX, b.minY - board.minY, board.maxY - b.maxY)
}

describe("B5: the order on a board with blocks", () => {
  for (const blocksFirst of [true, false]) {
    test(`whole-board autoplace${blocksFirst ? " after CH1 is laid out" : " from nothing"}: connectors on edges, blocks whole, side by side, turned alike`, async () => {
      await call("new_circuit", eightInputs)
      if (blocksFirst) await call("autoplace", { file: FILE, instance: "CH1" })
      const answer = await call("autoplace", { file: FILE, fit: true })
      expect(answer.text).toMatch(/^Placed 34 parts; .*; 0 overlaps$/m)
      const design = await build()
      expect(overlapping(design)).toEqual([])
      expect(outside(design)).toEqual([])
      // On an edge: no farther from it than the 2 mm margin the fitted board leaves round the parts.
      for (const connector of ["J1", "J2"]) expect(edgeGap(design, connector)).toBeLessThanOrEqual(2.01)
      // Every instance keeps CH1's arrangement and all have one turn.
      const turns = new Set((design.circuit.instances ?? []).map((instance) => instance.pcb?.rotation ?? 0))
      expect(turns.size).toBe(1)
      const shape = (n: number) => partsOf(design, n).map((p) => `${p.component.slice(0, 1)}${p.component.slice(-1)} ${(p.x - partsOf(design, n)[0]!.x).toFixed(2)} ${(p.y - partsOf(design, n)[0]!.y).toFixed(2)} ${p.rotation}`)
      for (const n of CHANNELS) expect(shape(n)).toEqual(shape(1))
      // A block is whole: its parts lie closer together than to any other block's.
      for (const n of CHANNELS) {
        const mine = boxOfPoints(partsOf(design, n).flatMap((p) => p.courtyard))
        expect((mine.maxX - mine.minX) * (mine.maxY - mine.minY)).toBeLessThan(40)
      }
    }, 120_000)
  }
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

describe("B6: the skill tells the agent the block flow", () => {
  const skill = (file: string) => readFile(join(process.cwd(), "skills", "copperflow", file), "utf8")

  test("SKILL.md step 7, copper.md and planning.md step 4 give blocks first, then the board, then the tracks between", async () => {
    const main = await skill("SKILL.md")
    const place = main.slice(main.indexOf("7. **Place.**"), main.indexOf("8. **"))
    for (const call of ['`autoplace` `{ file, instance: "CH1" }`', '`autoroute` `{ file, instance: "CH1" }`', "`render`", "`autoplace` `{ file, fit: true }`", "tracks between blocks"]) {
      expect(place).toContain(call)
    }
    expect(place.indexOf("instance:")).toBeLessThan(place.indexOf("fit: true"))
    const copper = await skill("references/copper.md")
    for (const answer of ["Placed 4 parts", "Routed 4 of 4 connections", "CH2 was moved as a", "removed (now unrouted)"]) expect(copper).toContain(answer)
    const planning = await skill("references/planning.md")
    expect(planning.slice(planning.indexOf("## 4."))).toContain("[copper.md](copper.md)")
  })
})
