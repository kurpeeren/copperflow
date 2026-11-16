import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { expect, test } from "vitest"
import { createCopperflowServer } from "../src/mcp/server.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

// The board the planning reference plans: one Input block written once and used eight times.
test("a block written once and used eight times builds as the planning reference says", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-plan-"))
  const server = createCopperflowServer(root, { engine: inProcessEngine as never })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "test", version: "0.0.0" })
  await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    return { text: (result.content as Array<{ text: string }>).map((c) => c.text).join("\n"), isError: result.isError === true }
  }
  const channels = [1, 2, 3, 4, 5, 6, 7, 8]

  const written = await call("new_circuit", {
    file: "io.circuit.tsx",
    place: false,
    sheets: {
      Input: {
        parts: [
          { name: "R1", kind: "resistor", value: "10k", footprint: "0603" },
          { name: "R2", kind: "resistor", value: "1.5k", footprint: "0603" },
          { name: "C1", kind: "capacitor", value: "100nF", footprint: "0603" },
          { name: "R3", kind: "resistor", value: "1k", footprint: "0603" },
        ],
        nets: { IN: ["R1.pin1"], DIV: ["R1.pin2", "R2.pin1", "R3.pin1"], OUT: ["R3.pin2", "C1.pin1"], GND: ["R2.pin2", "C1.pin2"] },
        ports: ["IN", "OUT", "GND"],
      },
    },
    instances: channels.map((n) => ({ sheet: "Input", name: `CH${n}`, connections: { IN: `IN${n}`, OUT: `DI${n}`, GND: "GND" } })),
    parts: [
      { name: "J1", kind: "pinheader", props: { pinCount: 9 } },
      { name: "J2", kind: "pinheader", props: { pinCount: 9 } },
    ],
    nets: {
      GND: ["J1.pin9", "J2.pin9"],
      ...Object.fromEntries(channels.map((n) => [`IN${n}`, [`J1.pin${n}`]])),
      ...Object.fromEntries(channels.map((n) => [`DI${n}`, [`J2.pin${n}`]])),
    },
  })

  expect(written.isError).toBe(false)
  expect(written.text).toContain("wrote io.circuit.tsx, Input.sheet.tsx")
  expect(written.text).toContain("2 parts, 8 instances")
  expect(written.text).toContain("CH8 Input base 800: IN=IN8 OUT=DI8 GND=GND")
  expect((await call("check_circuit", { file: "io.circuit.tsx", filter: "errors" })).text.split("\n")[0]).toMatch(/: 0 errors/)
  // Each use has its own designators on the board.
  const summary = (await call("circuit_summary", { file: "io.circuit.tsx" })).text
  for (const name of ["R101", "R801", "C801"]) expect(summary).toContain(name)
})
