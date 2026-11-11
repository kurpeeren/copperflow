// After new_circuit with place: false the parts have no position, and every answer says so: none gives a pad a place.
import { beforeAll, describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"
import { buildDesign } from "../src/engine/design.js"
import { padsById } from "../src/engine/pad-text.js"
import { routedLine } from "../src/mcp/route-tools.js"

let client: Client
const call = async (name: string, args: Record<string, unknown>) => ((await client.callTool({ name, arguments: args })).content as { text: string }[]).map((c) => c.text).join("\n")
/** A pad with a place: "R1.pin1 (-0.78, 0.00 top)". */
const PAD_PLACE = /\(-?\d+\.\d\d, -?\d+\.\d\d (top|bottom|through)\)/

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-unplaced-"))
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
})

describe("parts with no position", () => {
  test("new_circuit, check_circuit and board_summary agree: no position, no pad places", async () => {
    const parts = [
      { name: "R1", kind: "resistor", value: "1k", footprint: "0603" },
      { name: "R2", kind: "resistor", value: "1k", footprint: "0603" },
    ]
    const written = await call("new_circuit", { file: "a.circuit.tsx", place: false, parts, nets: { A: ["R1.pin1", "R2.pin1"], B: ["R1.pin2", "R2.pin2"] } })
    expect(written).not.toMatch(PAD_PLACE)
    const checked = await call("check_circuit", { file: "a.circuit.tsx" })
    expect(checked).toMatch(/^warning unplaced \[R1, R2\]: These parts have no position yet; autoplace places them$/m)
    expect(checked).toMatch(/^ {2}unrouted: R1\.pin1 \(not placed\) to R2\.pin1 \(not placed\)$/m)
    expect(checked).not.toMatch(PAD_PLACE)
    const summary = await call("board_summary", { file: "a.circuit.tsx" })
    expect(summary).toMatch(/^R1 1k 0603 not placed$/m)
    expect(summary).not.toMatch(PAD_PLACE)
  })

  test("autoroute and route_track name the pads of unplaced parts without a place", async () => {
    const parts = [
      { name: "R1", kind: "resistor", value: "1k", footprint: "0603" },
      { name: "R2", kind: "resistor", value: "1k", footprint: "0603" },
      { name: "R3", kind: "resistor", value: "1k", footprint: "0603" },
    ]
    await call("new_circuit", { file: "b.circuit.tsx", place: false, parts, nets: { A: ["R1.pin1", "R2.pin1"], B: ["R2.pin2", "R3.pin2"] } })
    // The router routes these two; the autoroute answer's unrouted line for an unplaced pad is built the same way.
    const design = buildDesign({ "b.circuit.tsx": 'export default () => (<board width="20mm" height="10mm"><resistor name="R1" resistance="1k" footprint="0603" /><resistor name="R2" resistance="1k" footprint="0603" /><trace from=".R1 > .pin1" to=".R2 > .pin1" /></board>)' }, "b.circuit.tsx")
    const failed = { net: "net.A", from: "R1#1", to: "R2#1", reason: "could not route R1.pin1 to R2.pin1: no room", blockers: [] }
    const line = routedLine({ routed: [], unrouted: [failed], passes: 1 }, padsById(design.pcb))
    expect(line).toBe("Routed 0 of 1 connection in 1 pass; unrouted: R1.pin1 (not placed) to R2.pin1 (not placed) (no room)")
    expect(await call("autoroute", { file: "b.circuit.tsx" })).not.toMatch(PAD_PLACE)
    const refused = await call("route_track", { file: "b.circuit.tsx", from: "R1.pin1", to: "R3.pin2" })
    expect(refused).toMatch(/R1\.pin1 \(not placed\) and R3\.pin2 \(not placed\) are not on one net/)
    expect(refused).not.toMatch(PAD_PLACE)
  })

  test("once autoplace has placed them, the same answers give the pads' places", async () => {
    await call("autoplace", { file: "a.circuit.tsx" })
    const checked = await call("check_circuit", { file: "a.circuit.tsx" })
    expect(checked).not.toMatch(/unplaced/)
    expect(checked).toMatch(PAD_PLACE)
  })
})
