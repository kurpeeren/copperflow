import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { Selection } from "../studio/src/selection.js"
import { NO_HIGHLIGHT, canonicalNet, highlightOf, menuHighlight, partNets, pcbNetAt, remapHighlight, schematicNetAt, selectionHighlight } from "../studio/src/pcb/highlight.js"

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
    expect(highlightOf(aliased, ["net.A"])).toEqual({ net: "net.A", pins: ["R1.pin1", "R2.pin1"], aliases: ["net.A", "net.B"] })
    expect(highlightOf(aliased, NO_HIGHLIGHT)).toBeUndefined()
  })
})

describe("highlighting a part's nets", () => {
  test("a part's nets come in pin order, each once; a part on no net has none", () => {
    expect(partNets(design, "R1")).toEqual(["net.GND", "net:R1.pin2"])
    expect(partNets(design, "R3")).toEqual([])
    expect(partNets(design, "nope")).toEqual([])
  })

  test("several nets light together: their pins and ids are all in the highlight", () => {
    const lit = highlightOf(design, ["net.GND", "net:R1.pin2"])
    expect(lit?.net).toBe("net.GND")
    expect(lit?.pins).toEqual(expect.arrayContaining(["R1.pin1", "R2.pin1", "R1.pin2", "R2.pin2"]))
    expect(lit?.aliases).toEqual(expect.arrayContaining(["net.GND", "net:R1.pin2"]))
  })

  test("an id that is not in the design is skipped", () => {
    expect(highlightOf(design, ["net:nope", "net.GND"])?.net).toBe("net.GND")
    expect(highlightOf(design, ["net:nope"])).toBeUndefined()
  })

  test("the menu lights the selected part's nets and never pretends without a part", () => {
    const nets: Record<string, readonly string[]> = { R1: ["net.GND"], R2: ["net.GND", "net.VCC"], C1: ["net.VCC", "net.OUT"] }
    const netsOf = (part: string) => nets[part] ?? []
    expect(menuHighlight(["R1"], netsOf)).toEqual({ nets: ["net.GND"] })
    expect(menuHighlight([], netsOf)).toEqual({ message: "Point at a net and press H." })
    expect(menuHighlight(["R3"], netsOf)).toEqual({ message: "R3 is on no net." })
  })

  test("with a wire selected the menu lights the wire's net; without one it lights the parts' nets", () => {
    const netsOf = (part: string) => (part === "R1" ? ["net.GND"] : [])
    const wireNet = (id: string) => (id === "wire:W" ? "net.VCC" : undefined)
    expect(selectionHighlight(Selection.none.onlyWire("wire:W"), wireNet, netsOf)).toEqual({ nets: ["net.VCC"] })
    expect(selectionHighlight(Selection.none.onlyWire("wire:gone"), wireNet, netsOf)).toEqual({ message: "Point at a net and press H." })
    expect(selectionHighlight(Selection.none.add(["R1"]), wireNet, netsOf)).toEqual({ nets: ["net.GND"] })
  })

  test("with several parts selected the menu lights all their nets, each once", () => {
    const nets: Record<string, readonly string[]> = { R1: ["net.GND"], R2: ["net.GND", "net.VCC"], C1: ["net.VCC", "net.OUT"] }
    const netsOf = (part: string) => nets[part] ?? []
    expect(menuHighlight(["R1", "R2", "C1"], netsOf)).toEqual({ nets: ["net.GND", "net.VCC", "net.OUT"] })
    expect(menuHighlight(["R3", "R4"], netsOf)).toEqual({ message: "R3 and R4 are on no net." })
  })
})

describe("remapHighlight", () => {
  const before = buildDesign({ [FILE]: SOURCE }, FILE)
  const withGnd = buildDesign({ [FILE]: SOURCE.replace("</board>", `<trace from=".R1 > .pin2" to="net.GND" /></board>`) }, FILE)

  test("an id that still exists is kept", () => {
    const kept = ["net.GND"]
    expect(remapHighlight(kept, before, withGnd)).toBe(kept)
  })

  test("an unnamed net that was named follows its first pin", () => {
    expect(before.circuit.nets.some((n) => n.id === "net:R1.pin2")).toBe(true)
    expect(remapHighlight(["net:R1.pin2"], before, withGnd)).toEqual(["net.GND"])
    expect(remapHighlight(["net.GND", "net:R1.pin2"], before, withGnd)).toEqual(["net.GND"])
  })

  test("a net that is gone is cleared, and no highlight stays none", () => {
    expect(remapHighlight(["net:nope"], before, withGnd)).toBe(NO_HIGHLIGHT)
    expect(remapHighlight(NO_HIGHLIGHT, before, withGnd)).toBe(NO_HIGHLIGHT)
  })

  test("with no earlier design an unknown id is cleared", () => {
    expect(remapHighlight(["net:R1.pin2"], undefined, buildDesign({ [FILE]: "export default () => <board />" }, FILE))).toBe(NO_HIGHLIGHT)
  })
})
