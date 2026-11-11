import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { resolveCircuit } from "../src/core/workspace.js"
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
