import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import type { Circuit, Point } from "../../src/engine/model.js"
import { layoutSchematic, type PlacedSymbol, type SchematicLayout, type Wire } from "../../src/engine/schematic.js"

const MAIN = "main.circuit.tsx"
const noPads = { padCount: () => undefined }

const source = (body: string): string => `export default () => (\n  <board width="10mm" height="10mm">\n${body}\n  </board>\n)\n`

function build(body: string): Circuit {
  return elaborate(evaluateCircuit({ [MAIN]: source(body) }, MAIN), MAIN, noPads)
}

const resistor = (name: string, x: number, y: number, extra = "") => `<resistor name="${name}" schX={${x}} schY={${y}}${extra} />`
const trace = (from: string, to: string, extra = "") => `<trace from="${from}" to="${to}"${extra} />`

/** A segment's ends in tenths. */
const tenths = (from: Point, to: Point): [number, number, number, number] => [from.x, from.y, to.x, to.y].map((v) => Math.round(v * 10)) as [number, number, number, number]

/** Every grid point a wire passes through, in tenths, one point per 0.1 step. */
function latticePoints(wire: Wire): Point[] {
  return wire.points.slice(1).flatMap((to, i) => {
    const from = wire.points[i] as Point
    const [ax, ay, bx, by] = tenths(from, to)
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay))
    return Array.from({ length: steps + 1 }, (_, k) => ({ x: ax + (Math.sign(bx - ax) * k), y: ay + (Math.sign(by - ay) * k) }))
  })
}

/** The unit grid edges a wire runs along, as "x,y|x,y" keys in tenths. */
function gridEdges(wire: Wire): string[] {
  const edges: string[] = []
  wire.points.slice(1).forEach((to, i) => {
    const from = wire.points[i] as Point
    const [ax, ay, bx, by] = tenths(from, to)
    const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay))
    for (let k = 0; k < steps; k++) {
      const p = { x: ax + Math.sign(bx - ax) * k, y: ay + Math.sign(by - ay) * k }
      const q = { x: p.x + Math.sign(bx - ax), y: p.y + Math.sign(by - ay) }
      const [lo, hi] = p.x < q.x || p.y < q.y ? [p, q] : [q, p]
      edges.push(`${lo.x},${lo.y}|${hi.x},${hi.y}`)
    }
  })
  return edges
}

const isOrthogonal = (wire: Wire): boolean => wire.points.slice(1).every((p, i) => p.x === wire.points[i]?.x || p.y === wire.points[i]?.y)

/** The symbol's bounds on the sheet, rotation 0 only. */
const boxOf = (symbol: PlacedSymbol) => ({
  minX: symbol.x + symbol.symbol.bounds.minX,
  maxX: symbol.x + symbol.symbol.bounds.maxX,
  minY: symbol.y + symbol.symbol.bounds.minY,
  maxY: symbol.y + symbol.symbol.bounds.maxY,
})

const wireOf = (layout: SchematicLayout, id: string): Wire => {
  const wire = layout.wires.find((candidate) => candidate.id === id)
  if (!wire) throw new Error(`no wire ${id}`)
  return wire
}

describe("routing around things", () => {
  test("a wire goes around a symbol in its way", () => {
    const layout = layoutSchematic(build([resistor("R1", 0, 0), resistor("R2", 4, 0), resistor("R3", 2, 0), trace("R1.pin2", "R2.pin1")].join("\n")))
    const wire = wireOf(layout, "wire:R1.pin2|R2.pin1")
    expect(wire.points[0]).toEqual({ x: 0.5, y: 0 })
    expect(wire.points[wire.points.length - 1]).toEqual({ x: 3.5, y: 0 })
    expect(isOrthogonal(wire)).toBe(true)
    const r3 = boxOf(layout.symbols.find((s) => s.component === "R3") as PlacedSymbol)
    const inside = latticePoints(wire).filter((p) => p.x / 10 >= r3.minX && p.x / 10 <= r3.maxX && p.y / 10 >= r3.minY && p.y / 10 <= r3.maxY)
    expect(inside).toEqual([])
  })

  test("a wire leaves and enters its pins from outside the symbol", () => {
    const layout = layoutSchematic(build([resistor("R1", -0.5, 0), resistor("R2", 2.5, 1), trace("R1.pin2", "R2.pin1")].join("\n")))
    const { points } = wireOf(layout, "wire:R1.pin2|R2.pin1")
    expect(points[0]).toEqual({ x: 0, y: 0 })
    expect(points[1]?.y).toBe(0)
    expect(points[points.length - 1]).toEqual({ x: 2, y: 1 })
    expect(points[points.length - 2]?.y).toBe(1)
    expect(points[points.length - 2]?.x).toBeLessThan(2)
  })

  test("two nets never share a grid edge", () => {
    const body = [
      resistor("R1", 0, 0),
      resistor("R2", 0, -1),
      resistor("R3", 3, 2, " schRotation={90}"),
      resistor("R4", 3, 3.5, " schRotation={90}"),
      trace("R1.pin2", "R3.pin1"),
      trace("R2.pin2", "R4.pin1"),
    ].join("\n")
    const layout = layoutSchematic(build(body))
    const owner = new Map<string, string>()
    for (const wire of layout.wires) {
      for (const edge of gridEdges(wire)) {
        expect(owner.get(edge) ?? wire.net).toBe(wire.net)
        owner.set(edge, wire.net)
      }
    }
    expect(layout.wires).toHaveLength(2)
  })

  test("a hand-drawn wire is never moved and a routed wire does not run along or touch its corners", () => {
    const hand = trace("R5.pin2", "R6.pin1", " schematicRouteHints={[{ x: 2, y: 1 }, { x: 2, y: -1 }]}")
    const body = [resistor("R1", 0, 0), resistor("R2", 4, 0), resistor("R5", 0, 1), resistor("R6", 4, -1), trace("R1.pin2", "R2.pin1"), hand].join("\n")
    const layout = layoutSchematic(build(body))
    const handWire = wireOf(layout, "wire:R5.pin2|R6.pin1")
    expect(handWire.points).toEqual([{ x: 0.5, y: 1 }, { x: 2, y: 1 }, { x: 2, y: -1 }, { x: 3.5, y: -1 }])
    const routed = wireOf(layout, "wire:R1.pin2|R2.pin1")
    const shared = gridEdges(routed).filter((edge) => gridEdges(handWire).includes(edge))
    expect(shared).toEqual([])
    const corners = handWire.points.map((p) => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`)
    expect(latticePoints(routed).filter((p) => corners.includes(`${p.x},${p.y}`))).toEqual([])
  })

  test("a routed wire may end on a wire of its own net, with a junction there", () => {
    const body = [resistor("R1", 0, 0), resistor("R2", 3, 0), resistor("R3", 1.5, 2, " schRotation={90}"), trace("R1.pin2", "R2.pin1"), trace("R3.pin1", "R2.pin1")].join("\n")
    const layout = layoutSchematic(build(body))
    expect(wireOf(layout, "wire:R1.pin2|R2.pin1").points).toEqual([{ x: 0.5, y: 0 }, { x: 2.5, y: 0 }])
    expect(wireOf(layout, "wire:R3.pin1|R2.pin1").points).toEqual([{ x: 1.5, y: 1.5 }, { x: 1.5, y: 0 }])
    expect(layout.junctions).toEqual([{ x: 1.5, y: 0 }])
  })

  test("near pins of a named net are routed too", () => {
    const body = [resistor("R1", 0, 0), resistor("R2", 3, 0), resistor("R9", 1.5, 0, " schRotation={90}"), trace("R1.pin2", "net.CC1"), trace("R2.pin1", "net.CC1")].join("\n")
    const layout = layoutSchematic(build(body))
    const wire = wireOf(layout, "wire:net.CC1:1")
    expect(isOrthogonal(wire)).toBe(true)
    expect(wire.points.length).toBeGreaterThan(2)
  })
})

describe("when there is no way around", () => {
  const boxedIn = [resistor("R1", 0, 0), resistor("R3", 1.1, 0), resistor("R2", 4, 0), trace("R1.pin2", "R2.pin1")].join("\n")

  test("the wire is drawn straight and the design warns", () => {
    const design = buildDesign({ [MAIN]: source(boxedIn) }, MAIN)
    expect(wireOf(design.schematic, "wire:R1.pin2|R2.pin1").points).toEqual([{ x: 0.5, y: 0 }, { x: 3.5, y: 0 }])
    const warnings = design.diagnostics.filter((d) => d.code === "auto-route")
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      severity: "warning",
      items: ["R1.pin2", "R2.pin1"],
      message: "wire from R1.pin2 to R2.pin1 could not avoid other things; drawn straight",
    })
  })

  test("a design that routes cleanly has no auto-route warning", () => {
    const design = buildDesign({ [MAIN]: source([resistor("R1", 0, 0), resistor("R2", 4, 0), resistor("R3", 2, 0), trace("R1.pin2", "R2.pin1")].join("\n")) }, MAIN)
    expect(design.diagnostics.filter((d) => d.code === "auto-route")).toEqual([])
  })
})

describe("determinism", () => {
  test("the same circuit routes the same way twice", () => {
    const parts = Array.from({ length: 12 }, (_, i) => resistor(`R${i + 1}`, (i % 4) * 2, -Math.floor(i / 4) * 1.5))
    const traces = Array.from({ length: 11 }, (_, i) => trace(`R${i + 1}.pin2`, `R${i + 2}.pin1`))
    const nets = [trace("R1.pin1", "net.GND"), trace("R6.pin1", "net.GND"), trace("R3.pin1", "net.SIG"), trace("R8.pin2", "net.SIG")]
    const body = [...parts, ...traces, ...nets].join("\n")
    expect(layoutSchematic(build(body))).toEqual(layoutSchematic(build(body)))
  })
})

describe("pins already joined", () => {
  test("a trace between pins that other wires already join keeps today's elbow and gives no warning", () => {
    const body = [resistor("R1", 0, 0), resistor("R2", 3, 0), resistor("R3", 1.5, 2, " schRotation={90}")]
    const traces = [trace("R1.pin2", "R2.pin1"), trace("R3.pin1", "R2.pin1"), trace("R3.pin1", "R1.pin2")]
    const design = buildDesign({ [MAIN]: source([...body, ...traces].join("\n")) }, MAIN)
    expect(wireOf(design.schematic, "wire:R3.pin1|R1.pin2").points).toEqual([{ x: 1.5, y: 1.5 }, { x: 0.5, y: 1.5 }, { x: 0.5, y: 0 }])
    expect(design.diagnostics.filter((d) => d.code === "auto-route")).toEqual([])
  })
})
