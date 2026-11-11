import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import type { Circuit, Point, Side } from "../../src/engine/model.js"
import { junctionsOf, type PinSpot } from "../../src/engine/schematic-nets.js"
import { routeWires } from "../../src/engine/schematic-route.js"
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
  const symbolBoxes = (layout: SchematicLayout) => layout.symbols.map((symbol) => ({ name: symbol.component, ...boxOf(symbol) }))
  /** Grid points of the wire strictly inside a symbol's bounds, its own two ends left out. */
  const throughSymbols = (layout: SchematicLayout, wire: Wire) => {
    const [first, last] = [wire.points[0], wire.points[wire.points.length - 1]]
    const ends = [first, last].map((p) => `${Math.round((p?.x ?? 0) * 10)},${Math.round((p?.y ?? 0) * 10)}`)
    return latticePoints(wire).filter(
      (p) => !ends.includes(`${p.x},${p.y}`) && symbolBoxes(layout).some((b) => p.x / 10 >= b.minX && p.x / 10 <= b.maxX && p.y / 10 >= b.minY && p.y / 10 <= b.maxY),
    )
  }

  test("a trace closing a loop is routed, never drawn straight through a symbol, and gives no warning", () => {
    const body = [resistor("R1", 0, 0), resistor("R2", 3, 0), resistor("R3", 1.5, 2, " schRotation={90}")]
    const traces = [trace("R1.pin2", "R2.pin1"), trace("R3.pin1", "R2.pin1"), trace("R3.pin1", "R1.pin2")]
    const design = buildDesign({ [MAIN]: source([...body, ...traces].join("\n")) }, MAIN)
    const loop = wireOf(design.schematic, "wire:R3.pin1|R1.pin2")
    expect(loop.points[0]).toEqual({ x: 1.5, y: 1.5 })
    expect(loop.points[loop.points.length - 1]).toEqual({ x: 0.5, y: 0 })
    expect(isOrthogonal(loop)).toBe(true)
    expect(throughSymbols(design.schematic, loop)).toEqual([])
    expect(design.diagnostics.filter((d) => d.code === "auto-route")).toEqual([])
  })

  test("a repeated trace gets a wire of its own that goes around a symbol in the way, like the first", () => {
    const body = [resistor("R1", 0, 0), resistor("R2", 4, 0), resistor("R3", 2, 0), trace("R1.pin2", "R2.pin1"), trace("R1.pin2", "R2.pin1")]
    const layout = layoutSchematic(build(body.join("\n")))
    expect(layout.wires).toHaveLength(2)
    for (const wire of layout.wires) expect(throughSymbols(layout, wire)).toEqual([])
  })
})

describe("the router on its own", () => {
  const box = (minX: number, minY: number, maxX: number, maxY: number, pins: string[] = []) => ({ bounds: { minX, minY, maxX, maxY }, pins })
  const spot = (x: number, y: number, side: Side): PinSpot => ({ end: { x, y }, side })
  const inside = (p: Point, b: { minX: number; minY: number; maxX: number; maxY: number }, margin: number) =>
    p.x >= b.minX - margin - 1e-9 && p.x <= b.maxX + margin + 1e-9 && p.y >= b.minY - margin - 1e-9 && p.y <= b.maxY + margin + 1e-9

  test("a pin whose only way out lands in another symbol's margin gets out through it, clear of that symbol's body", () => {
    const b = { minX: 0.8, minY: 0.1, maxX: 1.8, maxY: 0.5 }
    const boxes = [box(-0.5, -0.2, 0.5, 0.2, ["A.p"]), box(b.minX, b.minY, b.maxX, b.maxY, ["B.p"]), box(3, -1.2, 4, -0.8, ["C.p"])]
    const spots = new Map([["A.p", spot(0.5, 0, "right")], ["B.p", spot(1.8, 0.3, "right")], ["C.p", spot(3, -1, "left")]])
    const routed = routeWires({ boxes, spots }, [], [{ id: "w", net: "n", from: "A.p", to: "C.p" }])
    expect(routed.diagnostics).toEqual([])
    const wire = routed.wires[0] as Wire
    expect(isOrthogonal(wire)).toBe(true)
    expect(latticePoints(wire).filter((p) => inside({ x: p.x / 10, y: p.y / 10 }, b, 0.05))).toEqual([])
  })

  test("neighbouring pins of one chip boxed in by a close part are joined with a short stub out of each pin", () => {
    const chip = box(3.9, -1.1, 5.7, 1.3, ["U.4", "U.5", "U.6"])
    const crystal = box(2.6, -0.35, 3.6, 0.35, ["Y.1"])
    const spots = new Map([
      ["U.4", spot(3.9, 0.6, "left")],
      ["U.5", spot(3.9, 0.4, "left")],
      ["U.6", spot(3.9, 0.2, "left")],
      ["Y.1", spot(3.6, 0, "right")],
    ])
    const requests = [
      { id: "a", net: "V", from: "U.4", to: "U.5" },
      { id: "b", net: "V", from: "U.5", to: "U.6" },
    ]
    const routed = routeWires({ boxes: [chip, crystal], spots }, [], requests)
    expect(routed.diagnostics).toEqual([])
    expect(routed.wires.map((w) => w?.points)).toEqual([
      [{ x: 3.9, y: 0.6 }, { x: 3.8, y: 0.6 }, { x: 3.8, y: 0.4 }, { x: 3.9, y: 0.4 }],
      [{ x: 3.8, y: 0.4 }, { x: 3.8, y: 0.2 }, { x: 3.9, y: 0.2 }],
    ])
    expect(routeWires({ boxes: [chip, crystal], spots }, [], requests)).toEqual(routed)
  })

  test("a wire of the group running inside a symbol's margin is not a place to end on", () => {
    const s = { minX: 1, minY: -0.2, maxX: 2, maxY: 0.2 }
    const boxes = [box(s.minX, s.minY, s.maxX, s.maxY), box(5, -0.2, 6, 0.2, ["B.p"]), box(1, -2.2, 2, -1.8, ["A.p"])]
    const spots = new Map([["B.p", spot(5, 0, "left")], ["A.p", spot(1.5, -1.8, "top")]])
    const along = { wire: { id: "hand", net: "n", points: [{ x: 5, y: 0 }, { x: 4.5, y: 0 }, { x: 4.5, y: -0.3 }, { x: 1.2, y: -0.3 }] }, pins: ["B.p"] }
    const routed = routeWires({ boxes, spots }, [along], [{ id: "w", net: "n", from: "A.p", to: "B.p" }])
    const points = routed.wires[0]?.points ?? []
    expect(routed.diagnostics).toEqual([])
    expect(inside(points[points.length - 1] as Point, s, 0.1)).toBe(false)
  })

  test("two groups of one net whose wires cross are joined by a short wire, not a warning", () => {
    const boxes = [box(-0.5, -0.2, 0.5, 0.2, ["A.p"]), box(1.5, -1.4, 2.5, -1, ["C.p"])]
    const spots = new Map([["A.p", spot(0.5, 0, "right")], ["C.p", spot(2, -1, "top")]])
    const across = { wire: { id: "a", net: "n", points: [{ x: 0.5, y: 0 }, { x: 3, y: 0 }] }, pins: ["A.p"] }
    const down = { wire: { id: "c", net: "n", points: [{ x: 2, y: -1 }, { x: 2, y: 1 }] }, pins: ["C.p"] }
    const routed = routeWires({ boxes, spots }, [across, down], [{ id: "w", net: "n", from: "A.p", to: "C.p" }])
    expect(routed.diagnostics).toEqual([])
    const joining = routed.wires[0]
    expect(joining?.points.length).toBeGreaterThanOrEqual(2)
    const ends = [joining?.points[0], joining?.points[(joining?.points.length ?? 1) - 1]]
    const junctions = junctionsOf([across.wire, down.wire, ...(joining ? [joining] : [])], spots)
    for (const end of ends) expect(junctions).toContainEqual(end)
  })

  test("a search that runs past its cap falls back with the warning", () => {
    const boxes = [box(-0.5, -0.2, 0.5, 0.2, ["A.p"]), box(4, -0.2, 5, 0.2, ["B.p"]), box(2, -1, 2.4, 1)]
    const spots = new Map([["A.p", spot(0.5, 0, "right")], ["B.p", spot(4, 0, "left")]])
    const request = { id: "w", net: "n", from: "A.p", to: "B.p" }
    expect(routeWires({ boxes, spots }, [], [request]).diagnostics).toEqual([])
    const capped = routeWires({ boxes, spots }, [], [request], { maxExpansions: 10 })
    expect(capped.diagnostics.map((d) => d.code)).toEqual(["auto-route"])
    expect(capped.wires[0]?.points).toEqual([{ x: 0.5, y: 0 }, { x: 4, y: 0 }])
  })
})
