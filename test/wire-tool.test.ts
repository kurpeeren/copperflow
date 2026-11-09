import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { endAt, freePin, namedNetsJoined, pinAt, wireEdits, type WireEnd } from "../studio/src/pcb/wire-tool.js"

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

describe("freePin", () => {
  test("a pin on no net is free; a pin on a named net or joined to another pin is not", () => {
    expect(freePin(design, "R3.pin2")).toBe(true)
    expect(freePin(design, "R3.pin1")).toBe(false)
    expect(freePin(design, "R1.pin2")).toBe(false)
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
  test("R1.pin2 to R3.pin2 with one corner gives one addTrace carrying the corner and the elbows around it (no slanted leg)", () => {
    const edits = wireEdits(design, pin("R1.pin2"), pin("R3.pin2"), [{ x: 4.5, y: 2 }])
    expect(edits).toEqual([
      {
        kind: "addTrace",
        from: "R1.pin2",
        to: "R3.pin2",
        schematicRouteHints: [
          { x: 4.5, y: 0 },
          { x: 4.5, y: 2 },
          { x: 6.5, y: 2 },
        ],
      },
    ])
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
          { x: 9, y: 1.2 },
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

describe("the corners a wire saves", () => {
  const at = (id: string, x: number, y: number): WireEnd => ({ ...pin(id), at: { x, y } })
  const hints = (edits: ReturnType<typeof wireEdits>) => (edits[0] as { schematicRouteHints?: unknown }).schematicRouteHints

  test("a corner off the axis of the previous point also writes the elbow, so every segment is horizontal or vertical", () => {
    const edits = wireEdits(design, at("R1.pin2", 0, 0), at("R3.pin2", 2, 2), [{ x: 1, y: 1 }])
    expect(hints(edits)).toEqual([{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }])
  })

  test("a wire with no bend needed writes no hints", () => {
    expect(hints(wireEdits(design, at("R1.pin2", 0, 0), at("R3.pin2", 3, 0), []))).toBeUndefined()
    expect(hints(wireEdits(design, at("R1.pin2", 0, 0), at("R3.pin2", 3, 0), [{ x: 1, y: 0 }]))).toBeUndefined()
  })

  test("repeated points and points in the middle of a straight run are dropped", () => {
    const edits = wireEdits(design, at("R1.pin2", 0, 0), at("R3.pin2", 4, 2), [{ x: 2, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }])
    expect(hints(edits)).toEqual([{ x: 4, y: 0 }])
  })

  test("positions are rounded to 4 decimals", () => {
    const edits = wireEdits(design, at("R1.pin2", 0, 0), at("R3.pin2", 2.000001, 1.00004), [])
    expect(hints(edits)).toEqual([{ x: 2, y: 0 }])
  })

  test("the bend of each leg decides the elbow: vertical first writes the other corner", () => {
    const start = at("R1.pin2", 0, 0)
    const end = at("R3.pin2", 2, 1)
    expect(hints(wireEdits(design, start, end, [], [true]))).toEqual([{ x: 0, y: 1 }])
    expect(hints(wireEdits(design, start, end, [], [false]))).toEqual([{ x: 2, y: 0 }])
  })

  test("each leg keeps its own bend; a corner in the middle of a straight run is dropped", () => {
    const edits = wireEdits(design, at("R1.pin2", 0, 0), at("R3.pin2", 3, 3), [{ x: 1, y: 1 }], [true, false])
    expect(hints(edits)).toEqual([{ x: 0, y: 1 }, { x: 3, y: 1 }])
  })

  test("a net end keeps its point as the last corner, after the elbows", () => {
    const gnd: WireEnd = { selector: "net.GND", at: { x: 2, y: 2 }, label: "GND", net: "GND" }
    expect(hints(wireEdits(design, at("R3.pin2", 0, 0), gnd, []))).toEqual([{ x: 2, y: 0 }, { x: 2, y: 2 }])
  })

  test("a net start keeps its point as the first corner", () => {
    const gnd: WireEnd = { selector: "net.GND", at: { x: 2, y: 2 }, label: "GND", net: "GND" }
    expect(hints(wireEdits(design, gnd, at("R3.pin2", 0, 0), [], [true]))).toEqual([{ x: 2, y: 2 }, { x: 2, y: 0 }])
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

const TWO_GROUNDS = `export default () => (
  <board width="30mm" height="18mm">
    <chip name="U1" footprint="soic8" schX={0} schY={0} pinLabels={{ pin1: "GND", pin2: "VIN", pin3: "EN", pin4: "GND" }} />
    <resistor name="R1" resistance="1k" footprint="0402" schX={6} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={6} schY={2} />
    <trace from=".U1 > .pin1" to=".R2 > .pin1" />
  </board>
)`
const twoGrounds = buildDesign({ "main.circuit.tsx": TWO_GROUNDS }, "main.circuit.tsx")

describe("a name that several pins of a part share", () => {
  test("is not written; each of those pins is written as pin<n>, and a unique name still is", () => {
    expect(endOf(twoGrounds, "U1.pin1").selector).toBe("U1.pin1")
    expect(endOf(twoGrounds, "U1.pin4").selector).toBe("U1.pin4")
    expect(endOf(twoGrounds, "U1.pin2").selector).toBe("U1.VIN")
  })

  test("a wire from the second GND pin is written from that pin", () => {
    expect(wireEdits(twoGrounds, endOf(twoGrounds, "U1.pin4"), endOf(twoGrounds, "R1.pin1"), [])).toEqual([
      { kind: "addTrace", from: "U1.pin4", to: "R1.pin1", schematicRouteHints: [{ x: 5.5, y: -0.3 }] },
    ])
  })

  test("the clicked pin's own net decides whether the wire is needed, not the first pin with that name", () => {
    expect(wireEdits(twoGrounds, endOf(twoGrounds, "U1.pin4"), endOf(twoGrounds, "R2.pin1"), [])).toEqual([
      { kind: "addTrace", from: "U1.pin4", to: "R2.pin1", schematicRouteHints: [{ x: 5.5, y: -0.3 }] },
    ])
    expect(wireEdits(twoGrounds, endOf(twoGrounds, "U1.pin1"), endOf(twoGrounds, "R2.pin1"), [])).toEqual([])
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

  test("a wire of an unnamed net resolves to its first pin and adds no net point", () => {
    const wire = labelled.schematic.wires.find((w) => w.net.startsWith("net:"))
    const a = wire?.points[0]
    const b = wire?.points[1]
    if (!a || !b) throw new Error("no unnamed wire")
    const end = endAt(labelled, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, 0.05)
    expect(end?.selector).toMatch(/^(LED1\.cathode|R1\.pin1)$/)
    const edits = wireEdits(labelled, endOf(labelled, "U1.pin1"), end as WireEnd, [{ x: 6, y: 1 }])
    expect(edits[0]).toMatchObject({ schematicRouteHints: [{ x: 6, y: 0.2 }, { x: 6, y: 1 }, { x: 4, y: 1 }] })
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
