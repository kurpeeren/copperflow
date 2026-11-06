import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { pcbNetAt, schematicNetAt } from "../studio/src/pcb/highlight.js"

const FILE = "main.circuit.tsx"
const SOURCE = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} pcbX={0} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} pcbX={5} pcbY={0} />
    <resistor name="R3" resistance="1k" footprint="0402" schX={6} schY={0} pcbX={10} pcbY={0} />
    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.GND" />
    <trace from=".R1 > .pin2" to=".R2 > .pin2" />
  </board>
)`
const design = buildDesign({ [FILE]: SOURCE }, FILE)
const REACH = 0.1

describe("schematicNetAt", () => {
  test("a pin end gives its net", () => {
    const at = design.schematic.symbols.find((s) => s.component === "R1")?.pinEnds["R1.pin1"]
    expect(at && schematicNetAt(design, at, REACH)).toBe("net.GND")
  })

  test("a pin end of an unnamed net gives that net's id", () => {
    const at = design.schematic.symbols.find((s) => s.component === "R1")?.pinEnds["R1.pin2"]
    expect(at && schematicNetAt(design, at, REACH)).toBe("net:R1.pin2")
  })

  test("a pin that is on no net gives nothing", () => {
    const at = design.schematic.symbols.find((s) => s.component === "R3")?.pinEnds["R3.pin1"]
    expect(at && schematicNetAt(design, at, REACH)).toBeUndefined()
  })

  test("a net label gives its net", () => {
    const label = design.schematic.labels.find((l) => l.net === "net.GND")
    expect(label && schematicNetAt(design, label.at, REACH)).toBe("net.GND")
  })

  test("a wire gives its net", () => {
    const wire = design.schematic.wires.find((w) => w.net === "net:R1.pin2")
    const [a, b] = [wire?.points[0], wire?.points[wire.points.length - 1]]
    if (!a || !b) throw new Error("no wire")
    expect(schematicNetAt(design, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, REACH)).toBe("net:R1.pin2")
  })

  test("empty sheet gives nothing", () => {
    expect(schematicNetAt(design, { x: 30, y: 30 }, REACH)).toBeUndefined()
  })
})

describe("pcbNetAt", () => {
  test("a pad gives its net", () => {
    const pad = design.pcb.parts.flatMap((p) => p.pads).find((p) => p.net === "net.GND")
    expect(pad && pcbNetAt(design.pcb, { x: pad.x, y: pad.y })).toBe("net.GND")
  })

  test("a pad with no net, and empty board, give nothing", () => {
    const loose = design.pcb.parts.flatMap((p) => p.pads).find((p) => p.net === null)
    expect(loose && pcbNetAt(design.pcb, { x: loose.x, y: loose.y })).toBeUndefined()
    expect(pcbNetAt(design.pcb, { x: 50, y: 50 })).toBeUndefined()
  })
})
