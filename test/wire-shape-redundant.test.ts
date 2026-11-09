import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"

const FILE = "main.circuit.tsx"
const circuit = (extra: string) => `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} pcbX={-5} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} pcbX={0} pcbY={0} />
    <resistor name="R3" resistance="1k" footprint="0402" schX={6} schY={0} pcbX={5} pcbY={0} />
    <trace from=".R1 > .pin1" to="net.VCC" />
    <trace from=".R2 > .pin1" to="net.VCC" />
    <trace from=".R3 > .pin1" to="net.VCC" />
    <trace from=".R1 > .pin2" to="net.GND" />
    <trace from=".R2 > .pin2" to="net.GND" />
    <trace from=".R3 > .pin2" to="net.GND" />
    <trace from=".R1 > .pin2" to=".Missing > .pin1" />
${extra}
  </board>
)`

const build = (extra: string) => buildDesign({ [FILE]: circuit(extra) }, FILE)

describe("a second trace between two pins that are on one named net", () => {
  const plain = build("")
  const extra = build(`    <trace from=".R1 > .pin1" to=".R2 > .pin1" />`)

  test("the netlist is the same", () => {
    expect(extra.circuit.nets).toEqual(plain.circuit.nets)
  })

  test("the PCB ratsnest is the same", () => {
    expect(extra.pcb.ratsnest).toEqual(plain.pcb.ratsnest)
    expect(plain.pcb.ratsnest.length).toBeGreaterThan(0)
  })

  test("the checks and the diagnostics are the same", () => {
    expect(extra.violations).toEqual(plain.violations)
    expect(extra.diagnostics).toEqual(plain.diagnostics)
  })

  test("only the connection list and the wire for that pair differ", () => {
    expect(extra.circuit.connections.length).toBe(plain.circuit.connections.length + 1)
    expect(extra.schematic.wires.some((w) => w.id === "wire:R1.pin1|R2.pin1")).toBe(true)
    expect(plain.schematic.wires.some((w) => w.id === "wire:R1.pin1|R2.pin1")).toBe(false)
    const pair = (w: { points: { x: number }[] }) => w.points.length
    expect(extra.schematic.wires.filter((w) => !w.connection && w.net === "net.VCC").map(pair).length).toBeLessThanOrEqual(
      plain.schematic.wires.filter((w) => !w.connection && w.net === "net.VCC").map(pair).length,
    )
  })

  test("the fixture has a diagnostic, so the comparison counts", () => {
    expect(plain.diagnostics.length).toBeGreaterThan(0)
  })
})
