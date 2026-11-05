import { describe, expect, test } from "vitest"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import type { Circuit } from "../../src/engine/model.js"
import { layoutSchematic } from "../../src/engine/schematic.js"

const MAIN = "main.circuit.tsx"
const noPads = { padCount: () => undefined }

function build(body: string): Circuit {
  const source = `export default () => (\n  <board width="10mm" height="10mm">\n${body}\n  </board>\n)\n`
  return elaborate(evaluateCircuit({ [MAIN]: source }, MAIN), MAIN, noPads)
}

const resistor = (name: string, x: number, y: number, extra = "") => `<resistor name="${name}" schX={${x}} schY={${y}}${extra} />`

describe("placement", () => {
  test("placed symbols stay put", () => {
    const layout = layoutSchematic(build(resistor("R1", 3.5, -2.5, " schRotation={-90}")))
    const [r1] = layout.symbols
    expect(r1).toMatchObject({ component: "R1", x: 3.5, y: -2.5, rotation: 270, autoPlaced: false })
    expect(r1?.pinEnds["R1.pin1"]).toEqual({ x: 3.5, y: -2 })
    expect(r1?.pinEnds["R1.pin2"]).toEqual({ x: 3.5, y: -3 })
  })

  test("unplaced symbols are auto-placed without overlap", () => {
    const layout = layoutSchematic(build(`<resistor name="R1" />\n<resistor name="R2" />\n<resistor name="R3" />`))
    expect(layout.symbols.every((s) => s.autoPlaced)).toBe(true)
    const boxes = layout.symbols.map((s) => ({
      minX: s.x + s.symbol.bounds.minX,
      maxX: s.x + s.symbol.bounds.maxX,
      minY: s.y + s.symbol.bounds.minY,
      maxY: s.y + s.symbol.bounds.maxY,
    }))
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) {
        const apart = a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY
        expect(apart).toBe(true)
      }
    }
  })

  test("auto-placed symbols go right of placed ones", () => {
    const layout = layoutSchematic(build(`${resistor("R1", 0, 0)}\n<resistor name="R2" />`))
    const [placed, auto] = layout.symbols
    expect(auto?.x).toBeGreaterThanOrEqual((placed?.x ?? 0) + (placed?.symbol.bounds.maxX ?? 0) + 1 - 1e-9)
  })
})

describe("wires", () => {
  test("hand-drawn corners are kept exactly", () => {
    const circuit = build(
      `${resistor("R1", 0, 0)}\n${resistor("R2", 3, 2)}\n<trace from="R1.pin2" to="R2.pin1" schematicRouteHints={[{ x: 1, y: 0 }, { x: 1, y: 2 }]} />`,
    )
    const layout = layoutSchematic(circuit)
    expect(layout.wires).toHaveLength(1)
    expect(layout.wires[0]).toMatchObject({ id: "wire:R1.pin2|R2.pin1", connection: "R1.pin2|R2.pin1" })
    expect(layout.wires[0]?.points).toEqual([{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 2 }, { x: 2.5, y: 2 }])
  })

  test("pin-to-pin wires turn once", () => {
    const layout = layoutSchematic(build(`${resistor("R1", -0.5, 0)}\n${resistor("R2", 2.5, 1)}\n<trace from="R1.pin2" to="R2.pin1" />`))
    expect(layout.wires[0]?.points).toEqual([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }])
  })

  test("aligned pins give one straight segment", () => {
    const layout = layoutSchematic(build(`${resistor("R1", 0, 0)}\n${resistor("R2", 2, 0)}\n<trace from="R1.pin2" to="R2.pin1" />`))
    expect(layout.wires[0]?.points).toEqual([{ x: 0.5, y: 0 }, { x: 1.5, y: 0 }])
  })

  test("a connection with an unresolved end makes no wire and does not throw", () => {
    const layout = layoutSchematic(build(`${resistor("R1", 0, 0)}\n<trace from="R9.pin1" to="R1.pin1" />`))
    expect(layout.wires).toEqual([])
  })

  test("a hand-drawn wire to a named net stops at the last corner with a label", () => {
    const circuit = build(`${resistor("R1", 0, 0)}\n<trace from="R1.pin2" to="net.CC1" schematicRouteHints={[{ x: 1, y: 0 }, { x: 1, y: 1 }]} />`)
    const layout = layoutSchematic(circuit)
    expect(layout.wires[0]?.points).toEqual([{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }])
    expect(layout.labels).toEqual([{ id: "label:R1.pin2|net.CC1", net: "net.CC1", text: "CC1", at: { x: 1, y: 1 }, side: "top", style: "label" }])
  })
})

describe("named nets", () => {
  const twoOnCC1 = (distance: number) =>
    layoutSchematic(build(`${resistor("R1", 0, 0)}\n${resistor("R2", distance, 0)}\n<trace from="R1.pin2" to="net.CC1" />\n<trace from="R2.pin1" to="net.CC1" />`))

  test("near pins on a named net get a wire and no label", () => {
    const layout = twoOnCC1(2)
    expect(layout.wires).toHaveLength(1)
    expect(layout.wires[0]?.id).toBe("wire:net.CC1:1")
    expect(layout.labels).toEqual([])
  })

  test("far pins on a named net get labels, not a wire", () => {
    const layout = twoOnCC1(11)
    expect(layout.wires).toEqual([])
    expect(layout.labels.map((l) => [l.text, l.style, l.id])).toEqual([
      ["CC1", "label", "label:net.CC1:R1.pin2"],
      ["CC1", "label", "label:net.CC1:R2.pin1"],
    ])
    expect(layout.labels[0]).toMatchObject({ at: { x: 0.5, y: 0 }, side: "right" })
    expect(layout.labels[1]).toMatchObject({ at: { x: 10.5, y: 0 }, side: "left" })
  })

  test("ground nets get a ground symbol per cluster", () => {
    const body = [resistor("R1", 0, 0), resistor("R2", 10, 0), resistor("R3", 20, 0)].join("\n")
    const traces = ["R1", "R2", "R3"].map((r) => `<trace from="${r}.pin2" to="net.GND" />`).join("\n")
    const layout = layoutSchematic(build(`${body}\n${traces}`))
    expect(layout.labels.map((l) => l.style)).toEqual(["ground", "ground", "ground"])
  })

  test("power nets get a power symbol", () => {
    const layout = layoutSchematic(build(`${resistor("R1", 0, 0)}\n<trace from="R1.pin1" to="net.VCC" />`))
    expect(layout.labels.map((l) => [l.text, l.style])).toEqual([["VCC", "power"]])
  })

  test("a rotated symbol turns its label side", () => {
    const layout = layoutSchematic(build(`${resistor("R1", 0, 0, " schRotation={90}")}\n<trace from="R1.pin1" to="net.GND" />`))
    expect(layout.labels[0]?.side).toBe("bottom")
  })
})

describe("junctions", () => {
  test("three wires meeting make a junction", () => {
    const body = [resistor("R1", 0, 0), resistor("R2", 4, 3), resistor("R3", 4, -3), `<trace from="R1.pin2" to="R2.pin1" />`, `<trace from="R1.pin2" to="R3.pin1" />`].join("\n")
    const layout = layoutSchematic(build(body))
    expect(layout.junctions).toEqual([{ x: 0.5, y: 0 }])
  })

  test("two wires meeting make none", () => {
    const layout = layoutSchematic(build(`${resistor("R1", 0, 0)}\n${resistor("R2", 2, 0)}\n<trace from="R1.pin2" to="R2.pin1" />`))
    expect(layout.junctions).toEqual([])
  })

  test("a wire ending inside another wire makes a junction", () => {
    const body = [
      resistor("R1", 0, 0),
      resistor("R2", 4, 0),
      resistor("R3", 2, 2, " schRotation={90}"),
      `<trace from="R1.pin2" to="R2.pin1" />`,
      `<trace from="R3.pin1" to="net.TAP" schematicRouteHints={[{ x: 2, y: 0 }]} />`,
    ].join("\n")
    const layout = layoutSchematic(build(body))
    expect(layout.junctions).toContainEqual({ x: 2, y: 0 })
  })
})
