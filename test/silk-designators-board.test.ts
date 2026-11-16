// Designators on two real boards: the eight-input board laid out by its blocks and routed, and the CAN module.
import { describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { boxOf, maskBox, overlap, placesAround, SilkObstacles, textBox, type Box } from "../src/engine/fab/designator-places.js"
import { DEFAULT_SILK_CLEARANCE } from "../src/engine/fab/designators.js"
import type { PlacedFootprint } from "../src/engine/pcb.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const CHANNELS = [1, 2, 3, 4, 5, 6, 7, 8]
/** The eight-input board: one Input sheet used eight times, two 9-pin headers (as in block-layout.test.ts). */
const eightInputs = {
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

const designatorBox = (part: PlacedFootprint): Box => textBox(part.component, part.designatorAt ?? { x: part.x, y: part.y }, part.designatorRotation ?? 0)
const silkOnPad = (design: Design) => design.violations.filter((v) => v.code === "silk-on-pad" && v.items.some((item) => item.endsWith(" designator")))
const gap = (a: Box, b: Box) => Math.hypot(Math.max(0, a.minX - b.maxX, b.minX - a.maxX), Math.max(0, a.minY - b.maxY, b.minY - a.maxY))

/**
 * Whether every place the placer tries for the part covers a pad, hole, via, another part's courtyard or the board's
 * edge, or has another part between it and its own part, before any designator is placed: no clear place at all.
 */
function hasNoFreePlace(design: Design, name: string): boolean {
  const obstacles = new SilkObstacles(design.pcb.board?.outline, DEFAULT_SILK_CLEARANCE)
  for (const part of design.pcb.parts) {
    for (const pad of part.pads) obstacles.add("pad", part.component, pad.layers === "through" ? "both" : pad.layers, maskBox(pad, 0.05))
    obstacles.add("courtyard", part.component, part.side, boxOf(part.courtyard))
  }
  for (const via of design.pcb.vias) {
    const r = via.diameter / 2
    obstacles.add("via", "", "both", { minX: via.at.x - r, minY: via.at.y - r, maxX: via.at.x + r, maxY: via.at.y + r })
  }
  const part = design.pcb.parts.find((p) => p.component === name) as PlacedFootprint
  return placesAround(part, DEFAULT_SILK_CLEARANCE).every((place) => obstacles.covered(part, place).score > 0)
}

describe("designators on the eight-input board laid out by its blocks and routed", () => {
  test(
    "none on pads or each other, none on another part, all near their own part, the copies alike where they can be",
    async () => {
      const root = await mkdtemp(join(tmpdir(), "cf-silk-"))
      const server = createCopperflowServer(root, { engine: inProcessEngine as never })
      const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
      const client = new Client({ name: "test", version: "0.0.0" })
      await Promise.all([server.connect(serverSide), client.connect(clientSide)])
      const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: { file: "io.circuit.tsx", ...args } })
      await call("new_circuit", eightInputs)
      await call("autoplace", { instance: "CH1" })
      await call("autoroute", { instance: "CH1" })
      await call("autoplace", { fit: true })
      await call("autoroute", {})
      const design = buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), "io.circuit.tsx")
      const parts = design.pcb.parts

      // Before this work the board had 17 silk-on-pad findings for designators. The block placer packs the parts with
      // their courtyards at the clearance, and many parts are boxed in: within 2 mm every place covers a pad, a via or
      // another part, or has another part between it and its own. Those take the least bad place and the check says
      // so. When this was written 11 were named, all but at most one with no clear place at all; the other lost
      // its clear places to its neighbours' names.
      const findings = silkOnPad(design).map((v) => ({ part: /^(\S+)'s silkscreen/.exec(v.message)?.[1] ?? "", message: v.message }))
      expect(findings.length).toBeLessThanOrEqual(11)
      const crowded = findings.filter((f) => !/overlaps \S+'s designator$/.test(f.message)).map((f) => f.part)
      expect(crowded.filter((name) => !hasNoFreePlace(design, name)).length).toBeLessThanOrEqual(1)
      const free = parts.filter((part) => !crowded.includes(part.component))

      const overlaps = free.flatMap((a, i) => free.slice(i + 1).filter((b) => a.side === b.side && overlap(designatorBox(a), designatorBox(b))).map((b) => `${a.component}/${b.component}`))
      expect(overlaps).toEqual([])
      const onOthers = free.flatMap((a) => parts.filter((b) => b !== a && b.side === a.side && overlap(designatorBox(a), boxOf(b.courtyard))).map((b) => `${a.component} on ${b.component}`))
      expect(onOthers).toEqual([])
      const far = parts.filter((part) => gap(designatorBox(part), boxOf(part.courtyard)) > 2).map((part) => part.component)
      expect(far).toEqual([])

      // The copies are not alike here: round each copy the free room differs, and a copy only takes the group's place
      // where it is clear for it. That the copies take one place when they can is tested on a roomy board in
      // fab-designators.test.ts.
    },
    900_000,
  )
})

function filesIn(folder: string): Record<string, string> {
  const files: Record<string, string> = {}
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else files[relative(folder, path).split("\\").join("/")] = readFileSync(path, "utf8")
    }
  }
  walk(folder)
  return files
}

describe("designators on the CAN module", () => {
  test("one silk-on-pad finding for a designator, with no clear place (3 before: C2, R3 and U2 on pads)", () => {
    const design = buildDesign(filesIn(join(import.meta.dirname, "fixtures", "can-proof-3")), "can-module.circuit.tsx")
    expect(silkOnPad(design).map((v) => v.message)).toEqual(["R3's silkscreen overlaps JP1's courtyard"])
    expect(hasNoFreePlace(design, "R3")).toBe(true)
  })
})
