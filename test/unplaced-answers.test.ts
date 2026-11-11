// After new_circuit with place: false the parts have no position, and every answer says so: none gives a pad a place.
import { beforeAll, describe, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

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

  test("once autoplace has placed them, the same answers give the pads' places", async () => {
    await call("autoplace", { file: "a.circuit.tsx" })
    const checked = await call("check_circuit", { file: "a.circuit.tsx" })
    expect(checked).not.toMatch(/unplaced/)
    expect(checked).toMatch(PAD_PLACE)
  })
})
