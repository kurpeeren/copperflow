import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { endAt, namedNetsJoined, pinAt, wireEdits, type WireEnd } from "../studio/src/pcb/wire-tool.js"

const CIRCUIT = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={2} schY={0.4} />
    <resistor name="R3" resistance="1k" footprint="0402" schX={6} schY={1.2} />
    <trace from=".R1 > .pin1" to="net.GND" />
    <trace from=".R2 > .pin1" to="net.GND" />
    <trace from=".R1 > .pin2" to=".R2 > .pin2" />
    <trace from=".R3 > .pin1" to="net.VCC" />
  </board>
)`

const design = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx")

function pin(id: string): WireEnd {
  const at = design.schematic.symbols.find((s) => s.pinEnds[id])?.pinEnds[id]
  if (!at) throw new Error(`no pin ${id}`)
  const end = endAt(design, at, 0.01)
  if (!end) throw new Error(`no end at ${id}`)
  return end
}

describe("pinAt", () => {
  test("finds R1.pin1 within 0.12 and nothing beyond", () => {
    const at = design.schematic.symbols.find((s) => s.component === "R1")?.pinEnds["R1.pin1"]
    if (!at) throw new Error("no pin")
    expect(pinAt(design, { x: at.x + 0.1, y: at.y }, 0.12)?.pin).toBe("R1.pin1")
    expect(pinAt(design, { x: at.x + 0.13, y: at.y }, 0.12)).toBeUndefined()
  })
})

describe("endAt", () => {
  test("a pin gives its selector, label and net", () => {
    expect(pin("R1.pin1")).toMatchObject({ selector: "R1.pin1", label: "R1.pin1", net: "GND" })
  })

  test("a wire of net GND gives net.GND", () => {
    const wire = design.schematic.wires.find((w) => w.net === "net.GND")
    const a = wire?.points[0]
    const b = wire?.points[1]
    if (!a || !b) throw new Error("no GND wire")
    const end = endAt(design, { x: a.x + 0.1 * (b.x - a.x), y: a.y + 0.1 * (b.y - a.y) + 0.03 }, 0.05)
    expect(end).toMatchObject({ selector: "net.GND", net: "GND" })
  })

  test("nothing far from every pin, label and wire", () => {
    expect(endAt(design, { x: 40, y: 40 }, 0.1)).toBeUndefined()
  })
})

describe("wireEdits", () => {
  test("R1.pin2 to R3.pin2 with one corner gives one addTrace carrying the corner", () => {
    const corner = { x: 4.5, y: 2 }
    const edits = wireEdits(design, pin("R1.pin2"), pin("R3.pin2"), [corner])
    expect(edits).toEqual([{ kind: "addTrace", from: "R1.pin2", to: "R3.pin2", schematicRouteHints: [corner] }])
  })

  test("two pins already on one net give no edits", () => {
    expect(wireEdits(design, pin("R1.pin1"), pin("R2.pin1"), [])).toEqual([])
  })

  test("ending on a net writes the net selector and keeps the end point", () => {
    const gnd: WireEnd = { selector: "net.GND", at: { x: 9, y: 9 }, label: "GND", net: "GND" }
    const edits = wireEdits(design, pin("R3.pin2"), gnd, [{ x: 9, y: 0 }])
    expect(edits).toEqual([
      {
        kind: "addTrace",
        from: "R3.pin2",
        to: "net.GND",
        schematicRouteHints: [
          { x: 9, y: 0 },
          { x: 9, y: 9 },
        ],
      },
    ])
  })

  test("a part with a duplicate name cannot be addressed", () => {
    const dup: WireEnd = { selector: "R1~2.pin1", at: { x: 0, y: 0 }, label: "R1~2.pin1" }
    expect(wireEdits(design, dup, pin("R3.pin2"), [])).toEqual([])
  })
})

describe("namedNetsJoined", () => {
  test("names the two nets a wire would join", () => {
    expect(namedNetsJoined(design, pin("R1.pin1"), pin("R3.pin1"))).toEqual(["GND", "VCC"])
  })

  test("is undefined when one end has no named net", () => {
    expect(namedNetsJoined(design, pin("R1.pin2"), pin("R3.pin2"))).toBeUndefined()
  })

  test("is undefined inside one net", () => {
    expect(namedNetsJoined(design, pin("R1.pin1"), pin("R2.pin1"))).toBeUndefined()
  })
})

const LABELLED = `export default () => (
  <board width="30mm" height="18mm">
    <led name="LED1" footprint="0603" schX={0} schY={0} pinLabels={{ pin1: "anode", pin2: "cathode" }} />
    <chip name="U1" footprint="soic8" schX={4} schY={0} pinLabels={{ pin1: "VIN", pin2: ["GND", "VSS"] }} pinCount={3} />
    <resistor name="R1" resistance="1k" footprint="0402" schX={8} schY={0} />
    <trace from=".LED1 > .pin2" to=".R1 > .pin1" />
  </board>
)`
const labelled = buildDesign({ "main.circuit.tsx": LABELLED }, "main.circuit.tsx")

function endOf(d: typeof labelled, id: string): WireEnd {
  const at = d.schematic.symbols.find((s) => s.pinEnds[id])?.pinEnds[id]
  const end = at && endAt(d, at, 0.01)
  if (!end) throw new Error(`no end ${id}`)
  return end
}

describe("pin selectors", () => {
  test("a pin named by pinLabels is written with that name", () => {
    expect(endOf(labelled, "LED1.pin2").selector).toBe("LED1.cathode")
    expect(endOf(labelled, "U1.pin1").selector).toBe("U1.VIN")
    expect(endOf(labelled, "U1.pin2").selector).toBe("U1.GND")
  })

  test("a pin pinLabels does not name, and a kind alias, are written as pin<n>", () => {
    expect(endOf(labelled, "U1.pin3").selector).toBe("U1.pin3")
    expect(endOf(labelled, "R1.pin1").selector).toBe("R1.pin1")
  })
})

describe("where a wire ends", () => {
  test("a net end adds its click point as the last corner", () => {
    const gnd: WireEnd = { selector: "net.GND", at: { x: 9, y: 9 }, label: "GND", net: "GND" }
    const edits = wireEdits(labelled, endOf(labelled, "R1.pin2"), gnd, [{ x: 9, y: 0 }])
    expect(edits[0]).toMatchObject({ schematicRouteHints: [{ x: 9, y: 0 }, { x: 9, y: 9 }] })
  })

  test("the click point is skipped when it equals the previous corner", () => {
    const gnd: WireEnd = { selector: "net.GND", at: { x: 9, y: 0 }, label: "GND", net: "GND" }
    const edits = wireEdits(labelled, endOf(labelled, "R1.pin2"), gnd, [{ x: 9, y: 0 }])
    expect(edits[0]).toMatchObject({ schematicRouteHints: [{ x: 9, y: 0 }] })
  })

  test("a wire of an unnamed net resolves to its first pin and adds no corner", () => {
    const wire = labelled.schematic.wires.find((w) => w.net.startsWith("net:"))
    const a = wire?.points[0]
    const b = wire?.points[1]
    if (!a || !b) throw new Error("no unnamed wire")
    const end = endAt(labelled, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 0.05)
    expect(end?.selector).toMatch(/^(LED1\.cathode|R1\.pin1)$/)
    const edits = wireEdits(labelled, endOf(labelled, "U1.pin1"), end as WireEnd, [{ x: 6, y: 1 }])
    expect(edits[0]).toMatchObject({ schematicRouteHints: [{ x: 6, y: 1 }] })
  })
})

describe("label hit area", () => {
  test("a click on the far end of a long label hits the label, not the wire beside it", () => {
    const long = buildDesign(
      {
        "main.circuit.tsx": `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={20} schY={0} />
    <trace from=".R1 > .pin1" to="net.SIGNAL_LONG_NAME_X" />
    <trace from=".R2 > .pin1" to="net.SIGNAL_LONG_NAME_X" />
    <resistor name="R3" resistance="1k" footprint="0402" schX={-2} schY={0.3} />
    <resistor name="R4" resistance="1k" footprint="0402" schX={-2} schY={-0.3} />
    <trace from=".R3 > .pin1" to=".R4 > .pin1" />
  </board>
)`,
      },
      "main.circuit.tsx",
    )
    const label = long.schematic.labels.find((l) => l.style === "label" && l.text === "SIGNAL_LONG_NAME_X")
    if (!label) throw new Error("no tag label")
    const far = { x: label.at.x + (label.side === "left" ? -1 : 1) * 2.0, y: label.at.y }
    expect(long.schematic.wires.some((w) => w.points.some((q) => Math.abs(q.x - far.x) < 0.05))).toBe(true)
    const end = endAt(long, far, 0.05)
    expect(end).toMatchObject({ selector: "net.SIGNAL_LONG_NAME_X" })
    expect(end?.at).toEqual(label.at)
    expect(endAt(long, { x: label.at.x + (label.side === "left" ? -1 : 1) * 30, y: label.at.y }, 0.05)).toBeUndefined()
  })
})
