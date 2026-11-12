import { describe, expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
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

describe("check_circuit and autoroute tell the same story about a GND pour", () => {
  test("before the pour every connection counts; after it check_circuit separates the connections that need a track from the pads the pour joins, and autoroute's total is the first count", async () => {
    const call = await agent()
    const before = await call("check_circuit", { file: FILE })
    expect(before).toContain("warning unrouted: 5 connections are not routed yet")
    expect(before).not.toContain("joined by pours")
    expect(await call("add_pour", { file: FILE, net: "GND", layer: "top" })).toContain("joins 4 pads")
    const after = await call("check_circuit", { file: FILE })
    expect(after).toContain("unrouted: 2 connections are not routed yet and need a track; 4 pads on GND are joined by pours and need none")
    const routed = await call("autoroute", { file: FILE })
    expect(routed).toMatch(/Routed 2 of 2 connections in \d+ (?:pass|passes); 4 pads on GND are joined by pours and need no track/)
    expect(await call("check_circuit", { file: FILE })).not.toContain("not routed yet")
  })
})
