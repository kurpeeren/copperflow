import { describe, expect, test } from "vitest"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import { connectionsEdit, instanceEdit, sheetPorts } from "../src/core/instance-requests.js"
import { elaborate } from "../src/engine/elaborate.js"
import { evaluateCircuit } from "../src/engine/evaluate.js"

const MAIN = "main.circuit.tsx"
const SHEET = "Stage.sheet.tsx"
const STAGE = `export default function Stage() {
  return (
    <sheet>
      <port name="VIN" />
      <port name="GND" />
      <resistor name="R1" resistance="1k" />
      <trace from="R1.pin1" to="net.VIN" />
      <trace from="R1.pin2" to="net.GND" />
    </sheet>
  )
}
`
const BOARD = `export default () => (\n  <board width="20mm" height="20mm">\n    <resistor name="R1" />\n  </board>\n)\n`
const build = (text: string) => elaborate(evaluateCircuit({ [MAIN]: text, [SHEET]: STAGE }, MAIN), MAIN, { padCount: () => undefined })
const add = { kind: "addInstance", tag: "Stage", name: "S1", connections: { VIN: "VBUS", GND: "GND" }, importFrom: "./Stage.sheet" } as const

describe("addInstance", () => {
  test("writes the default import and the instance, which builds with its ports on the parent nets", () => {
    const text = applyEdits(BOARD, [add, { ...add, name: "S2", connections: { VIN: "V2", GND: "GND" }, base: 300 }], new Set())
    expect(text.match(/import Stage from "\.\/Stage\.sheet"/g)).toHaveLength(1)
    expect(text).toContain(`<Stage name="S1" connections={{ VIN: "VBUS", GND: "GND" }} />`)
    expect(text).toContain(`<Stage name="S2" connections={{ VIN: "V2", GND: "GND" }} base={300} />`)
    const circuit = build(text)
    expect(circuit.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(circuit.components.map((c) => c.id)).toEqual(["R1", "R101", "R301"])
    expect(circuit.nets.find((n) => n.names.includes("GND"))?.pins).toEqual(["R101.pin2", "R301.pin2"])
  })

  test("goes on a page when one is given", () => {
    const text = applyEdits(BOARD, [{ ...add, page: "Power" }], new Set())
    expect(build(text).instances?.[0]?.page).toBe("Power")
  })

  test("refuses a taken name, a bad net, a bad base and an import from elsewhere", () => {
    const once = applyEdits(BOARD, [add], new Set())
    expect(() => applyEdits(once, [add], new Set())).toThrow(/A part named S1 already exists/)
    expect(() => applyEdits(BOARD, [{ ...add, connections: { VIN: "a b" } }], new Set())).toThrow(/connections\.VIN must be a net name/)
    expect(() => applyEdits(BOARD, [{ ...add, base: 0 }], new Set())).toThrow(/base must be a whole number above 0/)
    expect(() => applyEdits(once, [{ ...add, name: "S3", importFrom: "./other/Stage.sheet" }], new Set())).toThrow(/already imported from "\.\/Stage\.sheet"/)
    expect(() => applyEdits(BOARD, [{ ...add, tag: "stage" }], new Set())).toThrow(/starts with a capital letter/)
  })
})

describe("setConnections", () => {
  test("replaces the instance's connections", () => {
    const once = applyEdits(BOARD, [add], new Set())
    const text = applyEdits(once, [{ kind: "setConnections", part: "S1", connections: { VIN: "V5", "V-X": "N" } }], new Set())
    expect(text).toContain(`<Stage name="S1" connections={{ VIN: "V5", "V-X": "N" }} />`)
  })

  test("adds connections to an instance written without them, and refuses a locked or missing one", () => {
    const bare = BOARD.replace("<resistor", `<Stage name="S1" />\n    <resistor`).replace("export default", `import Stage from "./Stage.sheet"\nexport default`)
    expect(applyEdits(bare, [{ kind: "setConnections", part: "S1", connections: { VIN: "V5" } }], new Set())).toContain(`<Stage name="S1" connections={{ VIN: "V5" }} />`)
    expect(() => applyEdits(bare, [{ kind: "setConnections", part: "S1", connections: {} }], new Set(["S1"]))).toThrow(/S1 is locked/)
    expect(() => applyEdits(bare, [{ kind: "setConnections", part: "S9", connections: {} }], new Set())).toThrow(/No part named S9/)
  })
})

describe("the edits made from a request", () => {
  const setup = async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-inst-"))
    await writeFile(join(root, SHEET), STAGE)
    return root
  }

  test("a sheet's ports are read from its file", () => {
    expect(sheetPorts(STAGE)).toEqual(["VIN", "GND"])
  })

  test("an instance of a sheet beside the circuit", async () => {
    const root = await setup()
    const circuit = { file: MAIN, model: analyzeCircuit(BOARD) }
    expect(await instanceEdit(root, circuit, { sheet: "Stage", name: "S1", connections: { VIN: "VBUS" }, base: 200 })).toEqual({
      kind: "addInstance",
      tag: "Stage",
      name: "S1",
      connections: { VIN: "VBUS" },
      base: 200,
      importFrom: "./Stage.sheet",
    })
  })

  test("an unknown port or sheet is refused, naming what there is", async () => {
    const root = await setup()
    const circuit = { file: MAIN, model: analyzeCircuit(BOARD) }
    await expect(instanceEdit(root, circuit, { sheet: "Stage", name: "S1", connections: { VOUT: "X" } })).rejects.toThrow("Stage has no port VOUT; its ports are VIN, GND")
    await expect(instanceEdit(root, circuit, { sheet: "Nope", name: "S1", connections: {} })).rejects.toThrow(/There is no sheet Nope: Nope\.sheet\.tsx does not exist/)
  })

  test("set_connections checks the ports of the instance's sheet", async () => {
    const root = await setup()
    const text = applyEdits(BOARD, [add], new Set())
    const circuit = { file: MAIN, model: analyzeCircuit(text) }
    expect(await connectionsEdit(root, circuit, { instance: "S1", connections: { GND: "AGND" } })).toEqual({ kind: "setConnections", part: "S1", connections: { GND: "AGND" } })
    await expect(connectionsEdit(root, circuit, { instance: "S1", connections: { X: "Y" } })).rejects.toThrow("Stage has no port X; its ports are VIN, GND")
    await expect(connectionsEdit(root, circuit, { instance: "R1", connections: {} })).rejects.toThrow("R1 is not a sub-sheet instance")
  })
})
