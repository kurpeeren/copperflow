import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { runCli } from "../src/cli-commands.js"
import { changeView } from "../src/core/change-view.js"
import { createCircuitFile } from "../src/core/workspace.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const BOARD = `export default () => (
  <board width="20mm" height="10mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-4} pcbY={0} schX={0} schY={0} />
    <capacitor name="C1" capacitance="1uF" footprint="0603" pcbX={4} pcbY={0} schX={3} schY={0} />
    <trace from=".R1 > .pin2" to=".C1 > .pin1" />
  </board>
)
`
const MAIN = "io.circuit.tsx"
let root: string
let client: Client
let builds = 0
const counting = {
  build: (root: string, file: string) => inProcessEngine.build(root, file),
  buildFiles: (files: Record<string, string>, main: string) => {
    builds += 1
    return inProcessEngine.buildFiles(files, main)
  },
}

const call = async (name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args })
  const text = (result.content as Array<{ type: string; text?: string }>).find((one) => one.type === "text")?.text ?? ""
  if (result.isError) throw new Error(text)
  return text
}
const cli = async (...args: string[]) => {
  const out: string[] = []
  const err: string[] = []
  const code = await runCli(args, root, { out: (s) => out.push(s), err: (s) => err.push(s) }, { engine: counting })
  return { code, out: out.join("\n"), err: err.join("\n") }
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "cf-change-view-"))
  const server = createCopperflowServer(root, { engine: counting })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  await createCircuitFile(root, MAIN, BOARD, { author: "human", summary: "create io.circuit.tsx" }) // c0001
  await call("set_props", { file: MAIN, part: "R1", props: { pcbX: -6 } }) // c0002
  await call("autoroute", { file: MAIN }) // c0003
  await call("remove_part", { file: MAIN, part: "C1" }) // c0004
  await writeFile(join(root, "broken.circuit.tsx"), "export default () => (<board")
}, 120_000)

afterAll(async () => {
  await client.close()
  await rm(root, { recursive: true, force: true })
})

describe("recent_changes and history with one change or since one", () => {
  test("one change: the title, then what changed", async () => {
    expect(await call("recent_changes", { id: "c0002" })).toBe(["Change c0002 by the agent: set R1 pcbX=-6", "Moved 1 part: R1"].join("\n"))
  })

  test("the autoroute: tracks as a count with their length", async () => {
    const text = await call("recent_changes", { id: "c0003" })
    expect(text).toMatch(/^Change c0003 by the agent: Autoroute the board: 1 of 1 connections\nCheck gone: 1 connection is not routed yet\nTracks: 1 added \([\d.]+ mm\)$/)
  })

  test("since a change: everything after it as one", async () => {
    const text = await call("recent_changes", { since: "c0002" })
    const lines = text.split("\n")
    expect(lines[0]).toBe("Since c0002: 2 changes, c0003 to c0004 (2 by the agent)")
    // Errors that appeared come first: the track now ends on nothing but R1's pad.
    expect(lines[1]).toMatch(/^New error: /)
    expect(lines.indexOf("Removed C1 (1uF, 0603)")).toBeGreaterThan(1)
    expect(lines.findIndex((line) => line.startsWith("New error"))).toBeLessThan(lines.indexOf("Removed C1 (1uF, 0603)"))
    expect(lines.some((line) => line.endsWith(" left") && line.includes("R1.pin2"))).toBe(true)
    expect(lines.length).toBeLessThanOrEqual(30)
  })

  test("without id or since it answers as before; with both it is refused", async () => {
    expect(await call("recent_changes", {})).toMatch(/^c0004 /m)
    await expect(call("recent_changes", { id: "c0002", since: "c0001" })).rejects.toThrow("Give id or since, not both")
    await expect(call("recent_changes", { id: "c0042" })).rejects.toThrow("No change c0042 in the history")
  })

  test("the CLI prints the same", async () => {
    expect(await cli("history", "c0002")).toEqual({ code: 0, out: await call("recent_changes", { id: "c0002" }), err: "" })
    expect((await cli("history", "--since", "c0002")).out).toBe(await call("recent_changes", { since: "c0002" }))
  })

  test("a new circuit has nothing before it: the side is named, with the file the text shows", async () => {
    expect(await call("recent_changes", { id: "c0001" })).toBe(
      ["Change c0001 by the person: create io.circuit.tsx", "Before the change the circuit code does not build: there was no io.circuit.tsx", `File io.circuit.tsx: new, ${BOARD.trim().split("\n").length} lines`].join("\n"),
    )
  })

  test("the two designs are built on request, one each, and only for the circuit the change wrote", async () => {
    builds = 0
    const view = await changeView(root, { id: "c0002" }, { engine: counting })
    expect(builds).toBe(2)
    expect(view.circuits.map((one) => one.file)).toEqual([MAIN])
    builds = 0
    await call("recent_changes", {})
    expect(builds).toBe(0)
  })
})
