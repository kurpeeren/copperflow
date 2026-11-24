import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { beforeEach, describe, expect, test } from "vitest"
import { listEntries } from "../src/core/index.js"
import { applyProtoEdits, protoAfter } from "../src/core/proto-writes.js"
import { autoroute, unroute } from "../src/mcp/route-tools.js"
import { protoNets } from "../src/mcp/proto-route.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
const LAYOUT = "main.circuit.layout.json"

const circuit = (kind: string) => `export default () => (
  <board kind="${kind}" columns={10} rows={6}>
    <pinheader name="J1" pinCount={3} pitch="2.54mm" pcbX={-6.35} pcbY={1.27} />
    <pinheader name="J2" pinCount={3} pitch="2.54mm" pcbX={-6.35} pcbY={-3.81} />
    <trace from="J1.pin1" to="net.A" />
    <trace from="J2.pin1" to="net.A" />
    <trace from="J1.pin3" to="net.B" />
    <trace from="J2.pin3" to="net.B" />
  </board>
)
`

let root: string
const ports = () => ({ root, engine: inProcessEngine as never })
const layout = () => readFile(join(root, LAYOUT), "utf8")
const design = () => inProcessEngine.build(root, FILE)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-proto-route-"))
})

describe("autoroute on a perfboard", () => {
  test("writes the solder runs as one change by the router", async () => {
    await writeFile(join(root, FILE), circuit("perfboard"))
    const text = await autoroute(ports(), { file: FILE })
    expect(text.split("\n")[0]).toMatch(/^Change c\d+: Joined 2 of 2 connections: 2 solder runs, 0 links, 0 cuts$/)
    expect(text).toMatch(/export \{ as: "build" \}/)
    expect(await layout()).toBe(['{"t":"solder","id":"s1","net":"A","holes":["C2","D2","E2"],"locked":false,"by":"router"}', '{"t":"solder","id":"s2","net":"B","holes":["C4","D4","E4"],"locked":false,"by":"router"}', ""].join("\n"))
    expect((await design()).pcb.ratsnest).toEqual([])
    expect((await listEntries(root, 1))[0]?.summary).toBe("Route the perfboard: 2 of 2 connections")
  }, 30_000)

  test("says when there is nothing to route, and writes nothing", async () => {
    await writeFile(join(root, FILE), circuit("perfboard"))
    await autoroute(ports(), { file: FILE })
    expect(await autoroute(ports(), { file: FILE })).toBe("Nothing to route: every connection in the scope is already joined. Nothing was written.")
  }, 30_000)

  test("routes the nets or parts asked for, and refuses an instance", async () => {
    await writeFile(join(root, FILE), circuit("perfboard"))
    expect(await autoroute(ports(), { file: FILE, nets: ["A"] })).toMatch(/Joined 1 of 1 connection: 1 solder run/)
    const built = await design()
    expect(protoNets(built, { parts: ["J2"] })?.sort()).toEqual(["net.A", "net.B"])
    expect(() => protoNets(built, { parts: ["J9"] })).toThrow("The circuit has no part J9. Nothing was written.")
    expect(() => protoNets(built, { nets: ["A"], parts: ["J1"] })).toThrow(/Give one of nets or parts/)
    await expect(autoroute(ports(), { file: FILE, instance: "PS1" })).rejects.toThrow(/not by instance/)
  }, 30_000)

  test("remove_copper takes back the router's records of a net, or all of them", async () => {
    await writeFile(join(root, FILE), circuit("perfboard"))
    await autoroute(ports(), { file: FILE })
    expect(await unroute(ports(), { file: FILE, nets: ["A"] })).toMatch(/^Change c\d+: removed 1 solder run, 0 links$/)
    expect((await design()).pcb.proto?.map((r) => r.id)).toEqual(["s2"])
    expect(await unroute(ports(), { file: FILE, all: true })).toMatch(/removed 1 solder run, 0 links, 0 cuts$/)
    await expect(unroute(ports(), { file: FILE, all: true })).rejects.toThrow(/no unrouted|no unlocked/)
  }, 30_000)
})

describe("autoroute on a stripboard", () => {
  test("writes links and cuts", async () => {
    await writeFile(join(root, FILE), circuit("stripboard"))
    const text = await autoroute(ports(), { file: FILE })
    expect(text.split("\n")[0]).toMatch(/^Change c\d+: Joined 2 of 2 connections: 0 solder runs, 2 links, \d+ cuts$/)
    const built = await design()
    expect(built.pcb.ratsnest).toEqual([])
    expect(built.violations.filter((v) => v.code.startsWith("proto-"))).toEqual([])
  }, 30_000)
})

describe("the writes", () => {
  test("give each draft the next id of its kind and refuse a locked or unknown record", () => {
    const before = [{ t: "link" as const, id: "w2", from: "A1", to: "A4", locked: true, by: "human" as const }]
    const { records, added } = protoAfter(before, [{ t: "link", net: "A", from: "B1", to: "B4" }, { t: "cut", at: "C3" }], [], "router")
    expect(added.map((r) => r.id)).toEqual(["w3", "x1"])
    expect(records).toHaveLength(3)
    expect(() => protoAfter(before, [], ["w2"], "agent")).toThrow("w2 is locked; ask the human to unlock it")
    expect(() => protoAfter(before, [], ["w9"], "agent")).toThrow("There is no solder run, link or cut w9")
    expect(() => protoAfter(before, [{ t: "cut", at: "nowhere" }], [], "agent")).toThrow("The new cut: at must be a hole name such as C7")
  })

  test("refuse an empty change, and keep tracks and references in the file", async () => {
    await writeFile(join(root, FILE), circuit("perfboard"))
    const track = '{"t":"track","id":"t0001","layer":"top","width":0.25,"points":[{"x":0,"y":0},{"x":1,"y":0}],"locked":false,"by":"human"}'
    await writeFile(join(root, LAYOUT), `${track}\n`)
    await expect(applyProtoEdits(root, FILE, [], [], { author: "ai", summary: "x" })).rejects.toThrow("No solder, links or cuts were given")
    await applyProtoEdits(root, FILE, [{ t: "link", net: "A", from: "B1", to: "B4" }], [], { author: "human", summary: "add a link" })
    // The file's first line now keeps the track counter, as every layout write does.
    const meta = '{"t":"meta","next":{"track":2,"via":1}}'
    expect(await layout()).toBe(`${meta}\n${track}\n{"t":"link","id":"w1","net":"A","from":"B1","to":"B4","locked":false,"by":"human"}\n`)
    await applyProtoEdits(root, FILE, [], ["w1"], { author: "human", summary: "remove it" })
    expect(await layout()).toBe(`${meta}\n${track}\n`)
  }, 30_000)
})
