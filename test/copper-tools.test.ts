import { beforeEach, describe, expect, test } from "vitest"
import { cp, mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { lockParts } from "../src/core/annotations.js"
import { listEntries } from "../src/core/index.js"
import { loadCircuit, resolveCircuit, updateAnnotations } from "../src/core/workspace.js"
import { buildDesign } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { createCopperflowServer } from "../src/mcp/server.js"

const FILE = "index.circuit.tsx"
const LAYOUT = "index.circuit.layout.json"
const EXAMPLE = fileURLToPath(new URL("../examples/usb-c-ldo", import.meta.url))
const NOW = "2026-11-10T10:00:00.000Z"
/** Builds in this process and, unlike the shared helper, reads rules.yaml as the real engine does. */
const engine = {
  build: async (root: string, file: string) =>
    buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), (await resolveCircuit(root, file)).file),
}
let root: string
let client: Client

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args })
  const content = result.content as Array<{ type: string; text: string }>
  return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
}

const pt = (x: number, y: number) => ({ x, y })
const route = (net: string, points: Array<{ x: number; y: number }>, extra: Record<string, unknown> = {}) =>
  call("route_track", { file: FILE, net, layer: "top", points, ...extra })
const entries = async () => (await listEntries(root, 100)).length
const layoutRecords = async () =>
  (await readFile(join(root, LAYOUT), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))

async function lockC1() {
  const { model } = await loadCircuit(root, FILE)
  await updateAnnotations(root, FILE, (a) => lockParts(a, model, ["C1"], NOW))
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-copper-tools-"))
  await cp(EXAMPLE, root, { recursive: true })
  const server = createCopperflowServer(root, { engine: engine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

describe("route_track", () => {
  test("routes from a pad with the net class width, as one history entry, and answers in a line", async () => {
    const before = await entries()
    const { text, isError } = await route("VBUS", [pt(-2.275, 0), pt(-2.275, -3), pt(1.55, -3), pt(1.55, -1.2875)])
    expect(isError).toBe(false)
    expect(text.split("\n")[0]).toMatch(/^Change c\d+: routed VBUS on top, 3 segments, 8.5 mm$/)
    expect(await entries()).toBe(before + 1)
    const [, track] = await layoutRecords()
    expect(track).toMatchObject({ t: "track", net: "VBUS", layer: "top", width: 0.4, by: "agent" })
  })

  test("takes an explicit width", async () => {
    await route("VBUS", [pt(-2.275, 0), pt(-2.275, -3)], { width: 0.6 })
    expect((await layoutRecords())[1]).toMatchObject({ width: 0.6 })
  })

  test("uses the fabrication default width when no class claims the net", async () => {
    await route("CC1", [pt(-4.93, 4), pt(-4.93, 6)])
    expect((await layoutRecords())[1]).toMatchObject({ net: "CC1", width: 0.25 })
  })

  test("is refused when the first point is not on copper of the net, naming the net", async () => {
    const { text, isError } = await route("VBUS", [pt(0, 5), pt(0, 6)])
    expect(isError).toBe(true)
    expect(text).toContain("VBUS")
    expect(text).toMatch(/first point/i)
  })

  test("may start on a track of the net and on a via of the net", async () => {
    await route("VBUS", [pt(-2.275, 0), pt(-2.275, -3)])
    expect((await route("VBUS", [pt(-2.275, -3), pt(0, -3)])).isError).toBe(false)
    await call("add_via", { file: FILE, at: pt(0, -3) })
    expect((await route("VBUS", [pt(0, -3), pt(0, -4)])).isError).toBe(false)
  })

  test("is refused when a point lands on another net's pad, naming both nets, and writes nothing", async () => {
    const before = await entries()
    const { text, isError } = await route("VBUS", [pt(-2.275, 0), pt(-0.725, 0)])
    expect(isError).toBe(true)
    expect(text).toContain("VBUS")
    expect(text).toContain("GND")
    expect(await entries()).toBe(before)
  })

  test("is refused when a point lands on another net's track", async () => {
    await route("V3_3", [pt(1.55, 1.2875), pt(1.55, 3), pt(5, 3)])
    const { text, isError } = await route("VBUS", [pt(-2.275, 0), pt(-2.275, 3), pt(3, 3)])
    expect(isError).toBe(true)
    expect(text).toContain("V3_3")
    expect(text).toContain("VBUS")
  })

  test("refuses an unknown net and lists the real ones", async () => {
    const { text, isError } = await route("VBUSS", [pt(-2.275, 0), pt(-2.275, -3)])
    expect(isError).toBe(true)
    expect(text).toContain("VBUS")
  })

  test("refuses a start on a locked part's pad and writes nothing", async () => {
    await lockC1()
    const before = await entries()
    const { isError, text } = await route("VBUS", [pt(-2.275, 0), pt(-2.275, -3)])
    expect(isError).toBe(true)
    expect(text).toContain("C1")
    expect(await entries()).toBe(before)
  })

  test("names the copper violations the change introduced", async () => {
    // Runs 0.225 mm above the GND pad of C1, whose top edge is at y 0.475.
    const { text } = await route("VBUS", [pt(-2.275, 0), pt(-2.275, 0.7), pt(-0.725, 0.7)], { width: 0.25 })
    expect(text).toMatch(/copper-clearance/)
  })

  test("says nothing about violations when it introduced none", async () => {
    const { text } = await route("VBUS", [pt(-2.275, 0), pt(-2.275, -3)])
    expect(text.split("\n")).toHaveLength(1)
  })
})

describe("add_via", () => {
  test("takes the net of the pad under it and the default via size", async () => {
    const { text } = await call("add_via", { file: FILE, at: pt(-2.275, 0) })
    expect(text.split("\n")[0]).toMatch(/^Change c\d+: added via v0001 on VBUS at \(-2\.275, 0\), 0\.3\/0\.66 mm$/)
    expect((await layoutRecords())[1]).toMatchObject({ t: "via", net: "VBUS", drill: 0.3, diameter: 0.66, layers: ["top", "bottom"] })
  })

  test("takes the net of the track under it", async () => {
    await route("VBUS", [pt(-2.275, 0), pt(-2.275, -3)])
    await call("add_via", { file: FILE, at: pt(-2.275, -2) })
    expect((await layoutRecords())[2]).toMatchObject({ t: "via", net: "VBUS" })
  })

  test("without copper under it and without a net, it has no net", async () => {
    const { text } = await call("add_via", { file: FILE, at: pt(0, 5) })
    expect(text).toContain("on no net")
    expect((await layoutRecords())[1].net).toBeUndefined()
  })

  test("an explicit net is used where there is no copper, and refused against another net's copper", async () => {
    expect((await call("add_via", { file: FILE, net: "GND", at: pt(0, 5) })).isError).toBe(false)
    const refused = await call("add_via", { file: FILE, net: "GND", at: pt(-2.275, 0) })
    expect(refused.isError).toBe(true)
    expect(refused.text).toContain("VBUS")
    expect(refused.text).toContain("GND")
  })

  test("refuses an unknown net", async () => {
    expect((await call("add_via", { file: FILE, net: "NOPE", at: pt(0, 5) })).isError).toBe(true)
  })
})

describe("remove_copper", () => {
  test("removes tracks and vias as one history entry", async () => {
    await route("VBUS", [pt(-2.275, 0), pt(-2.275, -3)])
    await call("add_via", { file: FILE, at: pt(0, 5) })
    const before = await entries()
    const { text, isError } = await call("remove_copper", { file: FILE, ids: ["t0001", "v0001"] })
    expect(isError).toBe(false)
    expect(text.split("\n")[0]).toMatch(/^Change c\d+: removed t0001, v0001$/)
    expect(await entries()).toBe(before + 1)
    expect((await layoutRecords()).filter((r) => r.t !== "meta")).toEqual([])
  })

  test("refuses an unknown id and a malformed one, writing nothing", async () => {
    await route("VBUS", [pt(-2.275, 0), pt(-2.275, -3)])
    const before = await entries()
    expect((await call("remove_copper", { file: FILE, ids: ["t0009"] })).isError).toBe(true)
    expect((await call("remove_copper", { file: FILE, ids: ["x1"] })).isError).toBe(true)
    expect(await entries()).toBe(before)
  })

  test("refuses a track that starts on a locked part", async () => {
    await route("VBUS", [pt(-2.275, 0), pt(-2.275, -3)])
    await lockC1()
    const { text, isError } = await call("remove_copper", { file: FILE, ids: ["t0001"] })
    expect(isError).toBe(true)
    expect(text).toContain("C1")
  })

  test("reports violations the removal introduced", async () => {
    await route("VBUS", [pt(-2.275, 0), pt(-2.275, -3)])
    await route("VBUS", [pt(-2.275, -3), pt(0, -3)])
    const { text } = await call("remove_copper", { file: FILE, ids: ["t0001"] })
    expect(text).toMatch(/floating/)
  })
})

describe("copper_summary", () => {
  test("lists a line per net with copper or unrouted connections, then the violation counts", async () => {
    await route("VBUS", [pt(-2.275, 0), pt(-2.275, -3), pt(1.55, -3), pt(1.55, -1.2875)])
    await call("add_via", { file: FILE, net: "GND", at: pt(0, 5) })
    const lines = (await call("copper_summary", { file: FILE })).text.split("\n")
    expect(lines[0]).toMatch(new RegExp(`^${FILE}: 1 track, 1 via, 8\\.5 mm of copper, \\d+ connections unrouted$`))
    expect(lines).toContainEqual(expect.stringMatching(/^VBUS: 1 track, 0 vias, 8.5 mm, \d+ unrouted$/))
    expect(lines).toContainEqual(expect.stringMatching(/^GND: 0 tracks, 1 via, 0\.0 mm, \d+ unrouted$/))
    expect(lines.at(-1)).toMatch(/^Copper violations: /)
  })

  test("counts violations by rule on one line", async () => {
    await route("VBUS", [pt(-2.275, 0), pt(-2.275, 0.7), pt(-0.725, 0.7)])
    const { text } = await call("copper_summary", { file: FILE })
    expect(text).toMatch(/Copper violations: \d+ \(.*copper-clearance \d+/)
  })

  test("says none when the copper is clean, and works with no layout file", async () => {
    const { text, isError } = await call("copper_summary", { file: FILE })
    expect(isError).toBe(false)
    expect(text).toContain("0 tracks, 0 vias")
    expect(text.split("\n").at(-1)).toBe("Copper violations: none")
  })

  test("stays within 60 lines and ends a long list with '… and N more'", async () => {
    const { text } = await call("copper_summary", { file: FILE })
    expect(text.split("\n").length).toBeLessThanOrEqual(60)
    // The example has 6 nets, all unrouted; a tiny limit is exercised in the unit test of copper-summary.
    expect(text.split("\n").filter((l) => /unrouted$/.test(l)).length).toBeGreaterThanOrEqual(5)
  })
})

describe("check_circuit copper filter", () => {
  test("shows only copper findings", async () => {
    await route("VBUS", [pt(-2.275, 0), pt(-2.275, 0.7), pt(-0.725, 0.7)])
    const { text } = await call("check_circuit", { file: FILE, filter: "copper" })
    const lines = text.split("\n")
    expect(lines[0]).toContain("filter: copper")
    expect(lines.slice(1).length).toBeGreaterThan(0)
    expect(lines.slice(1).every((l) => /(copper-|track-|via-|short|floating|mismatch)/.test(l))).toBe(true)
  })

  test("is mentioned in the tool description and the instructions", async () => {
    const tools = (await client.listTools()).tools
    expect(tools.find((t) => t.name === "check_circuit")?.description).toContain("copper")
    expect(client.getInstructions()).toMatch(/copper_summary/)
  })
})

describe("the tool list", () => {
  test("has the four copper tools and no unlock or verify tool", async () => {
    const names = (await client.listTools()).tools.map((t) => t.name)
    for (const name of ["route_track", "add_via", "remove_copper", "copper_summary"]) expect(names).toContain(name)
    expect(names.filter((n) => /unlock|verify/.test(n))).toEqual([])
  })
})

describe("copper_summary limit", () => {
  test("cuts the net lines at the limit and says how many more", async () => {
    const { formatCopperSummary } = await import("../src/mcp/copper-summary.js")
    const design = await engine.build(root, FILE)
    const lines = formatCopperSummary(FILE, design, 5).split("\n")
    expect(lines).toHaveLength(5)
    expect(lines[3]).toMatch(/^… and \d+ more nets$/)
    expect(lines[4]).toBe("Copper violations: none")
  })
})
