import { beforeEach, describe, expect, test } from "vitest"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { analyzeCircuit } from "../src/core/analyze.js"
import { emptyAnnotations, lockParts } from "../src/core/annotations.js"
import { applyEdits } from "../src/core/edit.js"
import { buildDesign } from "../src/engine/design.js"
import { createCopperflowServer } from "../src/mcp/server.js"
import { boardItemBlocker } from "../studio/src/pcb/pour-tool.js"
import { boardLockButton } from "../studio/src/pcb/pour-props.js"
import { inProcessEngine } from "./helpers/in-process-engine.js"

const MAIN = "main.circuit.tsx"
const SHEET = "Mount.sheet.tsx"
const NOW = "2026-11-11T10:00:00.000Z"

const MOUNT = `export default function Mount() {
  return (
    <sheet>
      <port name="GND" />
      <resistor name="R1" resistance="1k" footprint="0402" />
      <trace from="R1.pin1" to="net.GND" />
      <hole x={0} y={0} diameter={3.2} />
      <copperpour net="GND" layer="bottom" outline={[{x:-3,y:-3},{x:3,y:-3},{x:3,y:3},{x:-3,y:3}]} />
    </sheet>
  )
}
`

const BOARD = `import Mount from "./Mount.sheet"
export default () => (
  <board width="40mm" height="30mm">
    <Mount name="M1" connections={{ GND: "GND" }} pcbX={-10} pcbY={0} />
    <resistor name="R9" resistance="1k" footprint="0402" pcbX={10} pcbY={5} />
    <trace from="R9.pin1" to="net.GND" />
    <hole x={12} y={-8} diameter={2} />
    <copperpour net="GND" layer="top" />
  </board>
)
`
const files = { [MAIN]: BOARD, [SHEET]: MOUNT }

describe("pours and holes inside a sub-sheet instance", () => {
  test("the engine numbers them per file, as the core does: the circuit's own keep copperpour:N and hole:N, an instance's get its path first", () => {
    const design = buildDesign(files, MAIN)
    expect(design.pcb.holes.map((hole) => [hole.id, hole.x, hole.y])).toEqual([
      ["M1/hole:1", -10, 0],
      ["hole:1", 12, -8],
    ])
    expect(design.pcb.pours.map((pour) => pour.id)).toEqual(["M1/copperpour:1", "copperpour:1"])
    expect(analyzeCircuit(BOARD).boardItems?.map((item) => item.id)).toEqual(["hole:1", "copperpour:1"])
  })

  test("two instances of one sheet each count the sheet's own tags", () => {
    const two = { ...files, [MAIN]: BOARD.replace("<resistor name=\"R9\"", `<Mount name="M2" base={200} connections={{ GND: "GND" }} pcbX={0} pcbY={8} />\n    <resistor name="R9"`) }
    expect(buildDesign(two, MAIN).pcb.holes.map((hole) => hole.id)).toEqual(["M1/hole:1", "M2/hole:1", "hole:1"])
  })

  test("the core refuses an edit or a lock of an instance's pour or hole, naming the sheet file; hole:1 is the circuit's own", () => {
    expect(() => applyEdits(BOARD, [{ kind: "removeHole", id: "M1/hole:1" }], new Set())).toThrow(
      "M1/hole:1 is a hole inside the sub-sheet instance M1; edit Mount.sheet.tsx instead",
    )
    expect(() => applyEdits(BOARD, [{ kind: "setPour", id: "M1/copperpour:1", props: { priority: 1 } }], new Set())).toThrow(/edit Mount\.sheet\.tsx instead/)
    expect(applyEdits(BOARD, [{ kind: "removeHole", id: "hole:1" }], new Set())).not.toContain("<hole x={12}")
    expect(() => lockParts(emptyAnnotations(), analyzeCircuit(BOARD), ["M1/hole:1"], NOW)).toThrow(/edit Mount\.sheet\.tsx instead/)
    const locks = lockParts(emptyAnnotations(), analyzeCircuit(BOARD), ["hole:1"], NOW).locks
    expect(locks.map((lock) => lock.props)).toEqual([{ x: "{12}", y: "{-8}", diameter: "{2}" }])
  })

  test("the Studio blocks editing an instance's pour or hole and says where to edit it", () => {
    const model = analyzeCircuit(BOARD)
    expect(boardItemBlocker(model, new Set(), "M1/hole:1")).toBe("M1/hole:1 is a hole inside the sub-sheet instance M1; edit Mount.sheet.tsx instead")
    expect(boardItemBlocker(model, new Set(), "hole:1")).toBeNull()
    expect(boardLockButton("M1/hole:1", { locked: new Set(), violated: new Set() }).title).toMatch(/this hole/)
  })
})

describe("the agent's tools with a hole inside a sub-sheet", () => {
  let root: string
  let client: Client
  const call = async (name: string, args: Record<string, unknown>) => {
    const result = await client.callTool({ name, arguments: args })
    return { text: (result.content as { text: string }[]).map((c) => c.text).join("\n"), isError: result.isError === true }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "cf-sheet-items-"))
    await writeFile(join(root, MAIN), BOARD)
    await writeFile(join(root, SHEET), MOUNT)
    const server = createCopperflowServer(root, { engine: inProcessEngine })
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
    client = new Client({ name: "test", version: "0.0.0" })
    await Promise.all([server.connect(serverSide), client.connect(clientSide)])
  })

  test("copper_summary lists the instance's hole by its path; remove_hole hole:1 removes the circuit's own, and M1/hole:1 is refused", async () => {
    const summary = await call("copper_summary", { file: MAIN })
    expect(summary.text).toMatch(/^M1\/hole:1 at \(-10, 0\), 3\.2 mm$/m)
    expect(summary.text).toMatch(/^hole:1 at \(12, -8\), 2 mm$/m)
    const refused = await call("remove_hole", { file: MAIN, id: "M1/hole:1" })
    expect(refused.isError).toBe(true)
    expect(refused.text).toMatch(/edit Mount\.sheet\.tsx instead\. Nothing was written\./)
    const removed = await call("remove_hole", { file: MAIN, id: "hole:1" })
    expect(removed.isError).toBe(false)
    const text = await readFile(join(root, MAIN), "utf8")
    expect(text).not.toContain("<hole x={12}")
    expect(await readFile(join(root, SHEET), "utf8")).toBe(MOUNT)
  })
})
