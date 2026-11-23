import { describe, expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { buildDesign } from "../src/engine/design.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { withPourNote } from "../src/mcp/route-tools.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const FILE = "main.circuit.tsx"
const BOARD = `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-8} pcbY={4} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={0} pcbY={4} />
    <resistor name="R3" resistance="1k" footprint="0603" pcbX={8} pcbY={4} />
    <resistor name="R4" resistance="1k" footprint="0603" pcbX={0} pcbY={-4} />
    <trace from=".R1 > .pin1" to=".R2 > .pin1" />
    <trace from=".R3 > .pin1" to=".R4 > .pin1" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R2 > .pin2" to="net.GND" />
    <trace from=".R3 > .pin2" to="net.GND" />
    <trace from=".R4 > .pin2" to="net.GND" />
  </board>
)
`

async function agent(): Promise<(name: string, args?: Record<string, unknown>) => Promise<string>> {
  const root = await mkdtemp(join(tmpdir(), "cf-pour-count-"))
  await writeFile(join(root, FILE), BOARD)
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return async (name, args = {}) => ((await client.callTool({ name, arguments: args })).content as Array<{ text: string }>).map((c) => c.text).join("\n")
}

const numberAfter = (text: string, pattern: RegExp): number => Number(pattern.exec(text)?.[1] ?? Number.NaN)

describe("check_circuit and autoroute tell the same story about a GND pour", () => {
  test("the proof run's shape: K connections before the pour, K - M need a track after it, M are made by the pour, and the router routes K - M of K - M", async () => {
    const call = await agent()
    const before = await call("check_circuit", { file: FILE })
    const all = numberAfter(before, /unrouted: (\d+) connections are not routed yet/)
    expect(all).toBe(5)
    expect(before).not.toContain("made by pours")
    expect(await call("edit_circuit", { file: FILE, edits: [{ add_pour: { net: "GND", layer: "top" } }] })).toContain("joins 4 pads")
    const after = await call("check_circuit", { file: FILE })
    const needTrack = numberAfter(after, /unrouted: (\d+) connections are not routed yet and need a track/)
    const made = numberAfter(after, /; (\d+) more on GND are made by pours and need none/)
    expect(needTrack + made).toBe(all)
    const routed = await call("autoroute", { file: FILE })
    expect(numberAfter(routed, /Routed (\d+) of \d+ connections/)).toBe(needTrack)
    expect(numberAfter(routed, /Routed \d+ of (\d+) connections/)).toBe(needTrack)
    expect(numberAfter(routed, /; (\d+) connections on GND are made by pours/)).toBe(made)
    expect(await call("check_circuit", { file: FILE })).not.toContain("not routed yet")
  })

  test("the sentence covers only the nets in the route's scope", () => {
    const design = buildDesign({ [FILE]: BOARD.replace("  </board>", '    <copperpour net="GND" layer="top" />\n  </board>') }, FILE)
    const line = "Routed 2 of 2 connections in 1 pass"
    expect(withPourNote(line, design, { kind: "all" })).toBe(`${line}; 3 connections on GND are made by pours`)
    expect(withPourNote(line, design, { kind: "nets", nets: ["net.GND"] })).toBe(`${line}; 3 connections on GND are made by pours`)
    expect(withPourNote(line, design, { kind: "nets", nets: ["net.SIG"] })).toBe(line)
    expect(withPourNote(line, design, { kind: "parts", parts: ["R1"] })).toBe(`${line}; 3 connections on GND are made by pours`)
    expect(withPourNote(line, design, { kind: "parts", parts: [] })).toBe(line)
  })
})
