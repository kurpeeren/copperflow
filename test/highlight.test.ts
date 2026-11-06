import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { canonicalNet, highlightOf, pcbNetAt, remapHighlight, schematicNetAt } from "../studio/src/pcb/highlight.js"

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

const ALIASED = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <trace from=".R1 > .pin1" to="net.A" />
    <trace from=".R1 > .pin1" to="net.B" />
    <trace from=".R2 > .pin1" to="net.B" schematicRouteHints={[{ x: 2, y: 1 }]} />
  </board>
)`
const aliased = buildDesign({ [FILE]: ALIASED }, FILE)

describe("nets with two names", () => {
  test("the net's id is its first name, and a label on the second carries the raw second name", () => {
    expect(aliased.circuit.nets.map((n) => n.id)).toEqual(["net.A"])
    expect(aliased.schematic.labels.find((l) => l.text === "B")?.net).toBe("net.B")
  })

  test("canonicalNet maps either name to the net's id and leaves unknown ids alone", () => {
    expect(canonicalNet(aliased.circuit.nets, "net.B")).toBe("net.A")
    expect(canonicalNet(aliased.circuit.nets, "net.A")).toBe("net.A")
    expect(canonicalNet(aliased.circuit.nets, "net:x")).toBe("net:x")
  })

  test("H on a label of the second name gives the id the Nets tab knows", () => {
    const label = aliased.schematic.labels.find((l) => l.text === "B")
    expect(label && schematicNetAt(aliased, label.at, REACH)).toBe("net.A")
  })

  test("highlightOf lists the pins and every raw id the net's wires and labels may carry", () => {
    expect(highlightOf(aliased, "net.A")).toEqual({ net: "net.A", pins: ["R1.pin1", "R2.pin1"], aliases: ["net.A", "net.B"] })
    expect(highlightOf(aliased, null)).toBeUndefined()
  })
})

describe("remapHighlight", () => {
  const before = buildDesign({ [FILE]: SOURCE }, FILE)
  const withGnd = buildDesign({ [FILE]: SOURCE.replace("</board>", `<trace from=".R1 > .pin2" to="net.GND" /></board>`) }, FILE)

  test("an id that still exists is kept", () => {
    expect(remapHighlight("net.GND", before, withGnd)).toBe("net.GND")
  })

  test("an unnamed net that was named follows its first pin", () => {
    expect(before.circuit.nets.some((n) => n.id === "net:R1.pin2")).toBe(true)
    expect(remapHighlight("net:R1.pin2", before, withGnd)).toBe("net.GND")
  })

  test("a net that is gone is cleared, and null stays null", () => {
    expect(remapHighlight("net:nope", before, withGnd)).toBeNull()
    expect(remapHighlight(null, before, withGnd)).toBeNull()
  })

  test("with no earlier design an unknown id is cleared", () => {
    expect(remapHighlight("net:R1.pin2", undefined, buildDesign({ [FILE]: "export default () => <board />" }, FILE))).toBeNull()
  })
})
