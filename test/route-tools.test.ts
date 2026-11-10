import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { lockParts } from "../src/core/annotations.js"
import { applyLayoutEdits, listEntries } from "../src/core/index.js"
import { loadCircuit, resolveCircuit, updateAnnotations } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { createCopperflowServer } from "../src/mcp/server.js"

const FILE = "main.circuit.tsx"
const LAYOUT = "main.circuit.layout.json"
const NOW = "2026-11-10T10:00:00.000Z"
const resistor = (name: string, x: number, y: number, extra = "") => `    <resistor name="${name}" resistance="1k" footprint="0603" pcbX={${x}} pcbY={${y}} ${extra}/>`
const trace = (from: string, net: string) => `    <trace from="${from}" to="net.${net}" />`
const board = (width: number, height: number, body: readonly string[]) => `export default () => (
  <board width="${width}mm" height="${height}mm">
${body.join("\n")}
  </board>
)
`
/** Two nets that cross: R1 to R2 (A) and R3 to R4 (B). */
const CROSS = board(14, 12, [
  resistor("R1", -5.5, 0),
  resistor("R2", 5.5, 0),
  resistor("R3", 0, -4.5, "pcbRotation={90} "),
  resistor("R4", 0, 4.5, "pcbRotation={90} "),
  trace("R1.pin2", "A"),
  trace("R2.pin1", "A"),
  trace("R3.pin2", "B"),
  trace("R4.pin1", "B"),
])
/** SIG cannot pass the keepout; OTHER routes. */
const WALLED = board(20, 12, [
  resistor("R1", -6, -3),
  resistor("R2", 6, -3),
  resistor("R3", -6, 3),
  resistor("R4", -2, 3),
  "    <keepout pcbX={0} pcbY={0} width={1} height={14} />",
  trace("R1.pin2", "SIG"),
  trace("R2.pin1", "SIG"),
  trace("R3.pin2", "OTHER"),
  trace("R4.pin1", "OTHER"),
])
/** Twelve separate nets in two columns: more than a tiny budget routes. */
const MANY = board(30, 40, Array.from({ length: 12 }, (_, i) => [resistor(`L${i + 1}`, -6, (i - 5.5) * 3), resistor(`M${i + 1}`, 6, (i - 5.5) * 3), trace(`L${i + 1}.pin2`, `N${i + 1}`), trace(`M${i + 1}.pin1`, `N${i + 1}`)]).flat())

/** Builds in this process; `during` runs once inside the next build, as a write that lands while the board is routed. */
const hooks: { during?: (() => Promise<void>) | undefined } = {}
const build = async (root: string, file: string) => {
  const task = hooks.during
  hooks.during = undefined
  await task?.()
  return buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file)
}

let root: string
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

async function open(circuit: string) {
  root = await mkdtemp(join(tmpdir(), "cf-route-tools-"))
  await writeFile(join(root, FILE), circuit)
  const server = createCopperflowServer(root, { engine: { build } as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
}

const entries = async () => listEntries(root, 100)
const records = async () =>
  (await readFile(join(root, LAYOUT), "utf8").catch(() => ""))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { t?: string; id: string; by: string; points?: Array<{ x: number; y: number }> })
    .filter((record) => record.t !== "meta")
const design = () => build(root, FILE)

async function lock(parts: string[]) {
  const { model } = await loadCircuit(root, FILE)
  await updateAnnotations(root, FILE, (a) => lockParts(a, model, parts, NOW))
}

beforeEach(() => {
  hooks.during = undefined
})

describe("the tools' shapes", () => {
  test("autoroute takes the file, a scope and a budget; unroute the file and nets or all", async () => {
    await open(CROSS)
    const tools = (await client.listTools()).tools
    const autoroute = tools.find((tool) => tool.name === "autoroute")
    const unroute = tools.find((tool) => tool.name === "unroute")
    expect(Object.keys(autoroute?.inputSchema.properties ?? {}).sort()).toEqual(["budgetSeconds", "file", "instance", "nets", "parts"])
    expect(autoroute?.inputSchema.required).toEqual(["file"])
    expect(Object.keys(unroute?.inputSchema.properties ?? {}).sort()).toEqual(["all", "file", "nets"])
    expect(unroute?.annotations?.destructiveHint).toBe(true)
  })

  test("the instructions say: place first, then autoroute, then check_circuit; route by hand only what the router reports", async () => {
    await open(CROSS)
    const instructions = client.getInstructions() ?? ""
    const skill = await readFile(new URL("../skills/copperflow/SKILL.md", import.meta.url), "utf8")
    for (const text of [instructions, skill.replace(/\s+/g, " ")]) {
      expect(text).toMatch(/place the parts first, then run `?autoroute`?[^]*?, then `?check_circuit`? once at the end/)
      expect(text).toMatch(/Route by hand only what the router reports/)
      expect(text).toMatch(/`?unroute`?/)
    }
  })
})

describe("autoroute", () => {
  test("routes the board as one history entry by the agent, its records by the router, and answers in a line", async () => {
    await open(CROSS)
    const before = (await entries()).length
    const { text, isError } = await call("autoroute", { file: FILE })
    expect(isError).toBe(false)
    expect(text.split("\n")[0]).toMatch(/^Change c\d+: Routed 2 of 2 connections in \d+ pass(es)?$/)
    const after = await entries()
    expect(after.length).toBe(before + 1)
    expect(after[0]).toMatchObject({ author: "ai" })
    expect((await records()).every((record) => record.by === "router")).toBe(true)
    const built = await design()
    expect(built.pcb.ratsnest).toEqual([])
    expect(built.violations.filter((v) => /copper|hole|via|track|short/.test(v.code))).toEqual([])
  }, 30_000)

  test("names each connection it could not route, with the reason, and writes the rest", async () => {
    await open(WALLED)
    const { text } = await call("autoroute", { file: FILE })
    expect(text.split("\n")[0]).toMatch(/^Change c\d+: Routed 1 of 2 connections in \d+ pass(es)?; unrouted: R1\.pin2 to R2\.pin1 \(no way past keepout:1\)$/)
    expect((await design()).pcb.ratsnest).toHaveLength(1)
  }, 30_000)

  test("routes only the nets or parts asked for; an unknown net, part or instance, or two scopes, are refused", async () => {
    await open(CROSS)
    expect((await call("autoroute", { file: FILE, nets: ["B"] })).text).toMatch(/Routed 1 of 1 connection in/)
    expect((await design()).pcb.ratsnest.map((line) => line.net)).toEqual(["net.A"])
    const unknown = await call("autoroute", { file: FILE, nets: ["Z"] })
    expect(unknown.isError).toBe(true)
    expect(unknown.text).toMatch(/no net "Z"/)
    expect((await call("autoroute", { file: FILE, parts: ["R9"] })).text).toMatch(/no part R9/)
    expect((await call("autoroute", { file: FILE, instance: "PS1" })).text).toMatch(/no sub-sheet instance PS1/)
    const both = await call("autoroute", { file: FILE, nets: ["A"], parts: ["R1"] })
    expect(both.isError).toBe(true)
    expect(both.text).toMatch(/one of nets, parts or instance/)
    expect((await call("autoroute", { file: FILE, parts: ["R1"] })).text).toMatch(/^Change c\d+: Routed 1 of 1 connection/)
    expect((await call("autoroute", { file: FILE })).text).toBe("Nothing to route: every connection in the scope is already routed. Nothing was written.")
  }, 30_000)

  test("never starts a track on a locked part's pad", async () => {
    await open(CROSS)
    await lock(["R1", "R2"])
    expect((await call("autoroute", { file: FILE })).text).toMatch(/Routed 2 of 2/)
    const built = await design()
    const lockedPads = built.pcb.parts.filter((part) => part.component === "R1" || part.component === "R2").flatMap((part) => part.pads)
    for (const track of built.pcb.tracks) {
      const start = track.points[0]!
      expect(lockedPads.some((pad) => Math.hypot(pad.x - start.x, pad.y - start.y) < 0.3)).toBe(false)
    }
    expect(built.pcb.ratsnest).toEqual([])
  }, 30_000)

  test("a tiny budget: says the time ran out and writes only whole connections", async () => {
    await open(MANY)
    const lines = (await design()).pcb.ratsnest.length
    expect(lines).toBe(12)
    const before = (await entries()).length
    const { text, isError } = await call("autoroute", { file: FILE, budgetSeconds: 0.001 })
    expect(isError).toBe(false)
    expect(text).toMatch(/the time budget ran out/)
    expect(text).toMatch(/Stopped at the 0\.001 s time budget/)
    const routed = Number(/Routed (\d+) of 12 connections/.exec(text)?.[1])
    expect(routed).toBeLessThan(12)
    expect((await entries()).length).toBe(before + (routed > 0 ? 1 : 0))
    expect((await design()).pcb.ratsnest).toHaveLength(12 - routed)
  }, 30_000)

  test("a change written while it routes discards the result: nothing is written", async () => {
    await open(CROSS)
    hooks.during = async () => {
      await applyLayoutEdits(root, FILE, [{ kind: "addTrack", layer: "top", width: 0.25, points: [{ x: -6, y: 5 }, { x: -4, y: 5 }] }], { author: "human", summary: "Add track" })
    }
    const { text, isError } = await call("autoroute", { file: FILE })
    expect(isError).toBe(true)
    expect(text).toMatch(/changed while the board was routed/)
    expect((await records()).map((record) => record.by)).toEqual(["human"])
  }, 30_000)
})

describe("unroute", () => {
  const hand = () => applyLayoutEdits(root, FILE, [{ kind: "addTrack", layer: "top", width: 0.25, points: [{ x: -6, y: 5 }, { x: -4, y: 5 }] }], { author: "human", summary: "Add track" })

  test("removes the router's copper of some nets or all of it, as one entry; hand copper stays", async () => {
    await open(CROSS)
    await call("autoroute", { file: FILE })
    await hand()
    const before = (await entries()).length
    const one = await call("unroute", { file: FILE, nets: ["A"] })
    expect(one.text.split("\n")[0]).toMatch(/^Change c\d+: Unroute: remove \d+ tracks?( and \d+ vias?)? the router made$/)
    expect((await entries()).length).toBe(before + 1)
    expect((await design()).pcb.ratsnest.map((line) => line.net)).toEqual(["net.A"])
    await call("unroute", { file: FILE, all: true })
    expect((await records()).map((record) => record.by)).toEqual(["human"])
    const none = await call("unroute", { file: FILE, all: true })
    expect(none.isError).toBe(true)
    expect(none.text).toMatch(/no unlocked router copper/)
  }, 30_000)

  test("asks for nets or all, not both and not neither", async () => {
    await open(CROSS)
    expect((await call("unroute", { file: FILE })).text).toMatch(/Give nets or all: true/)
    expect((await call("unroute", { file: FILE, nets: ["A"], all: true })).text).toMatch(/Give nets or all: true/)
  })

  test("leaves a router track that starts on a part locked since, and names it", async () => {
    await open(CROSS)
    await call("autoroute", { file: FILE })
    await lock(["R1", "R2", "R3", "R4"])
    const { text, isError } = await call("unroute", { file: FILE, all: true })
    expect(isError).toBe(false)
    expect(text).toMatch(/left t\d{4} \(starts on the locked part R\d\)/)
    expect((await records()).length).toBeGreaterThan(0)
  }, 30_000)
})
