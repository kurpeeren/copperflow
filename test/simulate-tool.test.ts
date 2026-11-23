// simulate over the MCP server: a library module brought into a fresh project, run with sources set and with the
// sheet's own cases; list_modules { name } then shows each case with its last result.
import { afterEach, beforeEach, expect, test } from "vitest"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { ANSWER_LINES } from "../src/engine/sim/answer.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const KEYS = ["COPPERFLOW_HOME", "COPPERFLOW_MODULES", "COPPERFLOW_BUILTIN_LIBRARY"] as const
const saved = KEYS.map((key) => process.env[key])

beforeEach(async () => {
  process.env["COPPERFLOW_HOME"] = await mkdtemp(join(tmpdir(), "cf-home-"))
  process.env["COPPERFLOW_MODULES"] = await mkdtemp(join(tmpdir(), "cf-shelf-"))
  process.env["COPPERFLOW_BUILTIN_LIBRARY"] = resolve("library")
})

afterEach(() => {
  KEYS.forEach((key, i) => {
    if (saved[i] === undefined) delete process.env[key]
    else process.env[key] = saved[i]
  })
})

async function connect(root: string) {
  const server = createCopperflowServer(root, { engine: inProcessEngine })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  return async (name: string, args: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name, arguments: args })
    const content = result.content as Array<{ type: string; text: string }>
    return { text: content.map((c) => c.text).join("\n"), isError: result.isError === true }
  }
}

test("simulate runs a module's sheet with sources set, and its cases without", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-simtool-"))
  const call = await connect(root)
  const made = await call("new_circuit", { file: "main.circuit.tsx", parts: [{ name: "J1", kind: "pinheader", props: { pinCount: 2 } }], nets: { V12: ["J1.pin1"], GND: ["J1.pin2"] }, place: false })
  expect(made.isError, made.text).toBe(false)
  expect((await call("use_module", { module: "copperflow/RelayDriver", file: "main.circuit.tsx" })).isError).toBe(false)
  const on = await call("simulate", { file: "main.circuit.tsx", sheet: "RelayDriver", set: { V12: 12, GND: 0, CTRL: 3.3 } })
  expect(on.isError, on.text).toBe(false)
  expect(on.text.split("\n").length).toBeLessThanOrEqual(ANSWER_LINES)
  expect(on.text).toMatch(/K1 relay coil 12\.0 V 30\.0 mA 360 mW/)
  expect(on.text).toContain("Beyond a limit: none")
  const cases = await call("simulate", { file: "main.circuit.tsx", sheet: "RelayDriver" })
  expect(cases.text).toContain("Cases of RelayDriver: 4 of 4 passed")
  const info = await call("list_modules", { name: "copperflow/RelayDriver" })
  expect(info.text).toContain('  case "3.3 V control": V12=12, GND=0, CTRL=3.3; expects K1.coil.i 0.027 to 0.033, Q1.vgs 2.5 to 12, LED1.i 0.0015 to 0.0025 (last run: passed)')
  expect(info.text.split("\n").filter((line) => line.startsWith("  case ") && /verified/i.test(line))).toEqual([])
  expect(info.text).toContain("  A case that passes shows the block's DC levels with the models given, not that the module is verified.")
})

test("a circuit without set and without cases is told what to give", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-simtool-"))
  const call = await connect(root)
  await call("new_circuit", { file: "main.circuit.tsx", parts: [{ name: "R1", kind: "resistor", props: { resistance: "1k" } }], nets: { A: ["R1.pin1"], B: ["R1.pin2"] }, place: false })
  expect((await call("simulate", { file: "main.circuit.tsx" })).text).toBe("main.circuit.tsx has no cases: give set (net to volts), or write cases on the sheet's card with describe_sheet")
  expect((await call("simulate", { file: "main.circuit.tsx", set: { A: 1, B: 0 } })).text).toContain("R1 resistor 1.00 V 1.00 mA 1.00 mW")
})
