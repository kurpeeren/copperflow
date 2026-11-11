import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { existsSync } from "node:fs"
import { lockParts } from "../src/core/annotations.js"
import { loadCircuit, resolveCircuit, updateAnnotations } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { padPlace, padsById, unroutedPlaces } from "../src/engine/pad-text.js"
import type { WorldPad } from "../src/engine/pcb.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { unroutedLines } from "../src/mcp/copper-summary.js"
import { formatCompactCheck } from "../src/mcp/compact.js"
import { routedLine } from "../src/mcp/route-tools.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { checkCircuit } from "../src/core/check.js"

const FILE = "index.circuit.tsx"
const LAYOUT = "index.circuit.layout.json"
const EXAMPLE = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
const engine = {
  build: async (root: string, file: string) => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file),
}
let root: string
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

const records = async () =>
  (await readFile(join(root, LAYOUT), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))

/** Two pads of the net that copper does not join yet: the ends of its first ratsnest line. */
async function unroutedPair(net: string): Promise<[WorldPad, WorldPad]> {
  const design = await engine.build(root, FILE)
  const pads = padsById(design.pcb)
  const line = design.pcb.ratsnest.find((one) => one.net === `net.${net}`)
  if (line === undefined) throw new Error(`no ratsnest line on ${net}`)
  return [pads.get(line.from) as WorldPad, pads.get(line.to) as WorldPad]
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-route-ref-"))
  await cp(EXAMPLE, root, { recursive: true })
  const server = createCopperflowServer(root, { engine: engine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

describe("route_track by pad reference", () => {
  test("with from and to only, the router finds the path for that one connection and writes it as one change", async () => {
    const [a, b] = await unroutedPair("VBUS")
    const { text, isError } = await call("route_track", { file: FILE, from: a.pin, to: b.pin })
    expect(isError).toBe(false)
    expect(text.split("\n")[0]).toContain(`routed VBUS ${padPlace(a)} to ${padPlace(b)}`)
    const written = (await records()).filter((one) => one.t === "track")
    expect(written.length).toBeGreaterThan(0)
    expect(written.every((one) => one.net === "VBUS" && one.by === "agent")).toBe(true)
    const after = await engine.build(root, FILE)
    expect(after.pcb.ratsnest.some((line) => [line.from, line.to].includes(a.id) && [line.from, line.to].includes(b.id))).toBe(false)
  })

  test("with via points, one track from pad centre through them to pad centre", async () => {
    const [a, b] = await unroutedPair("VBUS")
    const corner = { x: a.x, y: b.y }
    const { isError, text } = await call("route_track", { file: FILE, from: a.pin, to: b.pin, via: [corner] })
    expect(text).toMatch(/routed VBUS on top, 2 segments/)
    expect(isError).toBe(false)
    const [track] = (await records()).filter((one) => one.t === "track")
    expect(track.points).toEqual([{ x: a.x, y: a.y }, corner, { x: b.x, y: b.y }])
  })

  test("is refused for pads on different nets, a missing end, both points and pads, and an unknown part", async () => {
    const [a] = await unroutedPair("VBUS")
    const [g] = await unroutedPair("GND")
    expect((await call("route_track", { file: FILE, from: a.pin, to: g.pin })).text).toMatch(/not on one net/)
    expect((await call("route_track", { file: FILE, from: a.pin })).text).toMatch(/both from and to/)
    expect((await call("route_track", { file: FILE, from: a.pin, to: a.pin, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })).text).toMatch(/not both/)
    expect((await call("route_track", { file: FILE, from: "Q99.pin1", to: a.pin })).text).toMatch(/no part Q99/)
  })
})

describe("route_track by reference on other pads", () => {
  const PAIR = `export default function Pair() {
  return (
    <sheet>
      <port name="IN" />
      <resistor name="R1" resistance="1k" footprint="0603" pcbX={-2} pcbY={0} />
      <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={2} pcbY={0} />
      <trace from="R1.pin1" to="net.IN" />
      <trace from="R1.pin2" to="C1.pin1" />
    </sheet>
  )
}
`
  const r = (name: string, x: number, y: number, extra = "") => `<resistor name="${name}" resistance="1k" footprint="0603" pcbX={${x}} pcbY={${y}} ${extra}/>`
  const MAIN = `import Pair from "./Pair.sheet"
export default () => (
  <board width="30mm" height="20mm">
    ${r("R1", -10, -5)}
    ${r("R2", -4, -5, 'layer="bottom" ')}
    <pinheader name="J1" pinCount={2} pitch="2.54mm" pcbX={-10} pcbY={4} />
    ${r("R3", -4, 4)}
    ${r("R4", 6, -6)}
    ${r("R5", 13, -6)}
    <keepout pcbX={9.5} pcbY={0} width={1} height={22} />
    <Pair name="P1" connections={{ IN: "A" }} pcbX={2} pcbY={5} />
    <trace from="R1.pin2" to="net.BOT" />
    <trace from="R2.pin1" to="net.BOT" />
    <trace from="J1.pin1" to="net.TH" />
    <trace from="R3.pin1" to="net.TH" />
    <trace from="R4.pin2" to="net.WALL" />
    <trace from="R5.pin1" to="net.WALL" />
  </board>
)
`
  beforeEach(async () => {
    const { writeFile } = await import("node:fs/promises")
    await writeFile(join(root, "pads.circuit.tsx"), MAIN)
    await writeFile(join(root, "Pair.sheet.tsx"), PAIR)
  })
  const route = (args: Record<string, unknown>) => call("route_track", { file: "pads.circuit.tsx", ...args })

  test("a pad on a flipped part reads bottom; from and to only, the router changes layer for it", async () => {
    const { text, isError } = await route({ from: "R1.pin2", to: "R2.pin1" })
    expect(isError, text).toBe(false)
    expect(text).toMatch(/R1\.pin2 \(\S+ \S+ top\) to R2\.pin1 \(\S+ \S+ bottom\): \d+ tracks?, [1-9]\d* vias?/)
    const refused = await route({ from: "R1.pin2", to: "R2.pin1", via: [{ x: -7, y: -7 }] })
    expect(refused.text).toMatch(/are not both on top/)
  })

  test("a through pad fits either layer; with via points the track takes the surface pad's layer", async () => {
    const { text, isError } = await route({ from: "J1.pin1", to: "R3.pin1", via: [{ x: -10, y: 6.5 }, { x: -4.775, y: 6.5 }] })
    expect(isError, text).toBe(false)
    expect(text).toMatch(/routed TH on top, 3 segments/)
    const design = await engine.build(root, "pads.circuit.tsx")
    expect(padPlace(padsById(design.pcb).get("J1#1") as WorldPad)).toMatch(/^J1\.pin1 \(\S+ \S+ through\)$/)
  })

  test("an instance reference P1/R1.pin2 names the instance's own part", async () => {
    const { text, isError } = await route({ from: "P1/R1.pin2", to: "P1/C1.pin1" })
    expect(isError, text).toBe(false)
    expect(text).toMatch(/R101\.pin2 \(.+\) to C101\.pin1 \(.+\)/)
    expect((await route({ from: "P9/R1.pin2", to: "P1/C1.pin1" })).text).toMatch(/no sub-sheet instance P9/)
  })

  test("is refused when there is no room, naming what is in the way, and writes nothing", async () => {
    const { text, isError } = await route({ from: "R4.pin2", to: "R5.pin1" })
    expect(isError).toBe(true)
    expect(text).toMatch(/^Could not route R4\.pin2 \(.+\) to R5\.pin1 \(.+\): no way past keepout:1\. Move a part, or give via points\. Nothing was written\.$/)
    expect(existsSync(join(root, "pads.circuit.layout.json"))).toBe(false)
  })

  test("is refused when it would start on a locked part's pad", async () => {
    const { model } = await loadCircuit(root, "pads.circuit.tsx")
    await updateAnnotations(root, "pads.circuit.tsx", (a) => lockParts(a, model, ["R3"], "2026-11-12T10:00:00.000Z"))
    const { text, isError } = await route({ from: "R3.pin1", to: "J1.pin1", via: [{ x: -4.775, y: 6.5 }, { x: -10, y: 6.5 }] })
    expect(isError).toBe(true)
    expect(text).toMatch(/R3/)
    expect(text).toMatch(/lock/i)
  })

  test("an unknown pin name is refused with the part's real pins", async () => {
    const { text } = await route({ from: "R1.VIN", to: "R2.pin1" })
    expect(text).toMatch(/R1 has no pin VIN; its pins are R1\.pin1.*R1\.pin2/)
  })
})

describe("unrouted connections carry their pads' positions", () => {
  test("in autoroute's line, copper_summary and check_circuit with the copper filter", async () => {
    const design = await engine.build(root, FILE)
    const places = unroutedPlaces(design.pcb)
    expect(places.length).toBeGreaterThan(0)
    expect(places[0]).toMatch(/^\w+\.pin\d+ \(-?\d+\.\d\d, -?\d+\.\d\d (top|bottom|through)\) to \w+\.pin\d+ \(-?\d+\.\d\d, -?\d+\.\d\d (top|bottom|through)\)$/)
    expect(unroutedLines(design)[0]).toBe(`Unrouted: ${places[0]}`)
    const [line] = design.pcb.ratsnest
    const one = { net: line?.net ?? "", from: line?.from ?? "", to: line?.to ?? "", reason: "could not route A to B: no room", blockers: [] }
    expect(routedLine({ routed: [], unrouted: [one], passes: 1 }, padsById(design.pcb))).toBe(`Routed 0 of 1 connection in 1 pass; unrouted: ${places[0]} (no room)`)
    const checked = formatCompactCheck(FILE, await checkCircuit(root, FILE, { engine: engine as never }), "copper")
    expect(checked).toContain(`  unrouted: ${places[0]}`)
    expect(checked).toMatch(/warning unrouted/)
  })
})
