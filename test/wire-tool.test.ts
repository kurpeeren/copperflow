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
    expect(pin("R1.pin1")).toMatchObject({ selector: "R1.left", label: "R1.left", net: "GND" })
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
    expect(edits).toEqual([{ kind: "addTrace", from: "R1.right", to: "R3.right", schematicRouteHints: [corner] }])
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
        from: "R3.right",
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
