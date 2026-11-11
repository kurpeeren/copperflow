// Where the placer's "beside the pin" rule must not fire, and where it must hold under locks and sub-sheet blocks.
import { describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import { ENGINE_FILES } from "../src/engine/engine.js"
import { collectProjectFiles } from "../src/engine/project-files.js"
import { roles } from "../src/engine/pcb-place/roles.js"
import { loadCircuit, updateAnnotations } from "../src/core/index.js"
import { lockParts } from "../src/core/annotations.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "g.circuit.tsx"
const chip = (name: string) => `<chip name="${name}" footprint="soic8" />`
const board = (body: string) => buildDesign({ [FILE]: `export default () => (<board width="40mm" height="30mm">${body}</board>)` }, FILE)
const trace = (from: string, to: string) => `<trace from="${from}" to="${to}" />`

describe("parts the rule leaves alone", () => {
  test("a series resistor or a coupling capacitor between two chips is beside neither", () => {
    const design = board(
      [chip("U1"), chip("U2"), '<resistor name="R1" resistance="33" footprint="0603" />', '<capacitor name="C1" capacitance="100nF" footprint="0603" />',
        trace(".U1 > .pin1", "net.A"), trace(".R1 > .pin1", "net.A"), trace(".R1 > .pin2", "net.B"), trace(".U2 > .pin1", "net.B"),
        trace(".U1 > .pin2", "net.C"), trace(".C1 > .pin1", "net.C"), trace(".C1 > .pin2", "net.D"), trace(".U2 > .pin2", "net.D"),
        '<resistor name="R2" resistance="10k" footprint="0603" />', trace(".R2 > .pin1", "net.E"), trace(".U1 > .pin3", "net.E"), trace(".R2 > .pin2", "net.V3_3")].join(""),
    )
    const r = roles(design)
    // The same board's pull-up on one chip's pin is beside it: the rule is on, and these two are what it leaves out.
    expect(r.beside("R2")?.part).toBe("U1")
    expect(r.beside("R1")).toBeUndefined()
    expect(r.beside("C1")).toBeUndefined()
  })

  test("a bulk capacitor on a rail several chips share is not a satellite", () => {
    const design = board(
      [chip("U1"), chip("U2"), chip("U3"), '<capacitor name="C9" capacitance="10uF" footprint="0805" />',
        trace(".U1 > .pin8", "net.V3_3"), trace(".U2 > .pin8", "net.V3_3"), trace(".U3 > .pin8", "net.V3_3"),
        trace(".C9 > .pin1", "net.V3_3"), trace(".C9 > .pin2", "net.GND"), trace(".U1 > .pin4", "net.GND")].join(""),
    )
    expect(roles(design).beside("C9")).toBeUndefined()
  })
})

async function server() {
  const root = await mkdtemp(join(tmpdir(), "cf-satellites-"))
  const srv = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([srv.connect(b), client.connect(a)])
  const call = async (name: string, args: Record<string, unknown>) => ((await client.callTool({ name, arguments: args })).content as { text: string }[]).map((c) => c.text).join("\n")
  const build = async (): Promise<Design> => buildDesign(await collectProjectFiles(root, { include: ENGINE_FILES }), FILE)
  return { call, build, root }
}

const padOn = (design: Design, part: string, pin: string) => design.pcb.parts.find((p) => p.component === part)?.pads.find((pad) => pad.pin === `${part}.${pin}`)
const gap = (design: Design, a: [string, string], b: [string, string]) => {
  const [p, q] = [padOn(design, ...a), padOn(design, ...b)]
  if (!p || !q) throw new Error("no pad")
  return Math.hypot(p.x - q.x, p.y - q.y)
}
const at = (design: Design, part: string) => design.pcb.parts.find((p) => p.component === part) as { x: number; y: number }

describe("the rule under locks and blocks", () => {
  test("a locked chip keeps its place and its movable crystal lands beside its pins", async () => {
    const { call, build, root } = await server()
    const parts = [{ name: "U1", kind: "chip", footprint: "soic8", props: { pcbX: 5, pcbY: 3 } }, { name: "Y1", kind: "crystal", value: "8MHz", footprint: "0603" }]
    await call("new_circuit", { file: FILE, place: false, board: { width: 40, height: 30 }, parts, nets: { X1: ["U1.pin2", "Y1.pin1"], X2: ["U1.pin3", "Y1.pin2"] } })
    const { model } = await loadCircuit(root, FILE)
    await updateAnnotations(root, FILE, (a) => lockParts(a, model, ["U1"], new Date().toISOString()))
    expect(await call("autoplace", { file: FILE })).toMatch(/^Placed 1 part/)
    const design = await build()
    expect(at(design, "U1")).toMatchObject({ x: 5, y: 3 })
    expect(gap(design, ["Y1", "pin1"], ["U1", "pin2"])).toBeLessThan(4)
    expect(gap(design, ["Y1", "pin2"], ["U1", "pin3"])).toBeLessThan(4)
  })

  test("satellites inside a sub-sheet instance moved as a block stay with the block", async () => {
    const { call, build } = await server()
    const sheet = {
      parts: [{ name: "U1", kind: "chip", footprint: "soic8" }, { name: "Y1", kind: "crystal", value: "8MHz", footprint: "0603" }],
      nets: { X1: ["U1.pin2", "Y1.pin1"], X2: ["U1.pin3", "Y1.pin2"], IN: ["U1.pin1"] },
      ports: ["IN"],
    }
    const instances = [
      { sheet: "Osc", name: "O1", connections: { IN: "S1" } },
      { sheet: "Osc", name: "O2", connections: { IN: "S2" } },
    ]
    await call("new_circuit", { file: FILE, place: false, board: { width: 40, height: 30 }, sheets: { Osc: sheet }, instances, parts: [{ name: "J1", kind: "pinheader", props: { pinCount: 2 } }], nets: { S1: ["J1.pin1"], S2: ["J1.pin2"] } })
    expect(await call("autoplace", { file: FILE })).toMatch(/O2 was moved as a block/)
    const design = await build()
    const offset = (u: string, y: string) => ({ x: at(design, y).x - at(design, u).x, y: at(design, y).y - at(design, u).y })
    const [first, second] = [offset("U101", "Y101"), offset("U201", "Y201")]
    expect(second.x).toBeCloseTo(first.x, 6)
    expect(second.y).toBeCloseTo(first.y, 6)
    expect(gap(design, ["Y201", "pin1"], ["U201", "pin2"])).toBeLessThan(4)
  })
})
