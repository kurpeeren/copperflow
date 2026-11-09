import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import type { Edit } from "../src/core/types.js"
import { buildDesign, type Design } from "../src/engine/design.js"
import { carryPath, dragCorner, dragSegment, removeCorner, tidy, wireBlocker, wireOf, wireShapeEdits, type WireShape } from "../studio/src/pcb/wire-shape.js"

const FILE = "main.circuit.tsx"
const p = (x: number, y: number) => ({ x, y })

const SOURCE = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <resistor name="R3" resistance="1k" footprint="0402" schX={6} schY={0} />
    <resistor name="R4" resistance="1k" footprint="0402" schX={0} schY={3} />
    <resistor name="R5" resistance="1k" footprint="0402" schX={0} schY={6} />
    <resistor name="R6" resistance="1k" footprint="0402" schX={3} schY={6} />
    <trace from=".R1 > .pin2" to=".R2 > .pin1" schematicRouteHints={[{ x: 1, y: 1 }, { x: 2, y: 1 }]} />
    <trace from=".R1 > .pin2" to=".R2 > .pin1" />
    <trace from=".R3 > .pin1" to="net.VCC" schematicRouteHints={[{ x: 7, y: 1 }, { x: 7, y: 2 }]} />
    <trace from="net.VCC" to=".R4 > .pin1" schematicRouteHints={[{ x: -2, y: 4 }, { x: -2, y: 2 }]} />
    <trace from=".R3 > .pin2" to=".R4 > .pin2" />
    <trace from=".R5 > .pin1" to="net.GND" />
    <trace from=".R6 > .pin1" to="net.GND" />
  </board>
)`

function setup(source = SOURCE) {
  const design = buildDesign({ [FILE]: source }, FILE)
  return { design, model: { model: analyzeCircuit(source) } }
}

const { design, model } = setup()
const wire = (id: string, d: Design = design, m = model): WireShape => {
  const found = wireOf(d, m, id)
  if (!found) throw new Error(`no wire ${id}: ${d.schematic.wires.map((w) => w.id).join(", ")}`)
  return found
}

/** Applies the edits to the source and returns the rebuilt wire. */
function saved(source: string, edits: Edit[], id: string): WireShape {
  const next = applyEdits(source, edits, new Set())
  const rebuilt = setup(next)
  return wire(id, rebuilt.design, rebuilt.model)
}

describe("tidy", () => {
  test("drops repeated points and points in a straight run, rounds to 4 decimals", () => {
    expect(tidy([p(0, 0), p(1, 0), p(1, 0), p(2.00001, 0), p(2.00001, 1)])).toEqual([p(0, 0), p(2, 0), p(2, 1)])
  })
})

describe("dragSegment", () => {
  const Z = [p(0, 0), p(0, 1), p(2, 1), p(2, 3)]

  test("a horizontal segment moves only up or down and its neighbours stretch", () => {
    expect(dragSegment(Z, 1, p(5, 0.5))).toEqual([p(0, 0), p(0, 1.5), p(2, 1.5), p(2, 3)])
  })

  test("a vertical segment moves only left or right", () => {
    const stair = [p(0, 0), p(1, 0), p(1, 2), p(3, 2)]
    expect(dragSegment(stair, 1, p(0.5, 9))).toEqual([p(0, 0), p(1.5, 0), p(1.5, 2), p(3, 2)])
  })

  test("a segment that touches a fixed end gets a new segment there, so the end stays put", () => {
    expect(dragSegment(Z, 0, p(0.5, 9))).toEqual([p(0, 0), p(0.5, 0), p(0.5, 1), p(2, 1), p(2, 3)])
    expect(dragSegment(Z, 2, p(-0.5, 9))).toEqual([p(0, 0), p(0, 1), p(1.5, 1), p(1.5, 3), p(2, 3)])
  })

  test("a straight wire dragged sideways becomes a U with both ends fixed", () => {
    expect(dragSegment([p(0, 0), p(4, 0)], 0, p(7, 1))).toEqual([p(0, 0), p(0, 1), p(4, 1), p(4, 0)])
  })

  test("a segment dragged into line with its far neighbour merges with it", () => {
    expect(dragSegment(Z, 1, p(0, 2))).toEqual([p(0, 0), p(0, 3), p(2, 3)])
  })

  test("a slanted segment (old files) moves by the whole delta", () => {
    const old = [p(0, 0), p(1, 1), p(2, 0), p(3, 1)]
    expect(dragSegment(old, 1, p(0.5, 0.25))).toEqual([p(0, 0), p(1.5, 1.25), p(2.5, 0.25), p(3, 1)])
  })

  test("a bad index or no movement leaves the path as it is", () => {
    expect(dragSegment(Z, 7, p(1, 1))).toEqual(Z)
    expect(dragSegment(Z, 1, p(3, 0))).toEqual(Z)
  })
})

describe("carryPath", () => {
  const Z = [p(0, 0), p(0, 1), p(2, 1), p(2, 3)]
  const STAY = { start: false, end: false }

  test("ends that stay keep their points and get a new segment across their own; every corner moves by the whole delta", () => {
    expect(carryPath(Z, p(0.5, 0.5), STAY)).toEqual([p(0, 0), p(0.5, 0), p(0.5, 1.5), p(2.5, 1.5), p(2.5, 3), p(2, 3)])
  })

  test("an end whose part moves goes along, so it needs no new segment", () => {
    expect(carryPath(Z, p(0.5, 0.5), { start: true, end: false })).toEqual([p(0.5, 0.5), p(0.5, 1.5), p(2.5, 1.5), p(2.5, 3), p(2, 3)])
    expect(carryPath(Z, p(0.5, 0.5), { start: true, end: true })).toEqual([p(0.5, 0.5), p(0.5, 1.5), p(2.5, 1.5), p(2.5, 3.5)])
    expect(carryPath(Z, p(0.5, 0.5), { start: false, end: true })).toEqual([p(0, 0), p(0.5, 0), p(0.5, 1.5), p(2.5, 1.5), p(2.5, 3.5)])
  })

  test("a delta along the end segments stretches them, as a segment drag does", () => {
    expect(carryPath(Z, p(0, 0.5), STAY)).toEqual(dragSegment(Z, 1, p(0, 0.5)))
  })

  test("a straight wire carried sideways becomes a U, its ends staying on their pins", () => {
    expect(carryPath([p(0, 0), p(4, 0)], p(1, 1), STAY)).toEqual([p(0, 0), p(0, 1), p(4, 1), p(4, 0)])
  })
})

describe("dragCorner", () => {
  const L = [p(0, 0), p(2, 0), p(2, 3)]

  test("both segments stay horizontal or vertical, and the fixed ends get new segments", () => {
    expect(dragCorner(L, 1, p(3, 1))).toEqual([p(0, 0), p(0, 1), p(3, 1), p(3, 3), p(2, 3)])
  })

  test("a corner between longer runs stretches the neighbours instead", () => {
    const S = [p(0, 0), p(0, 1), p(2, 1), p(2, 3), p(5, 3)]
    expect(dragCorner(S, 2, p(3, 2))).toEqual([p(0, 0), p(0, 2), p(3, 2), p(3, 3), p(5, 3)])
  })

  test("a corner dragged along one axis only moves that axis", () => {
    expect(dragCorner(L, 1, p(2, 1))).toEqual([p(0, 0), p(0, 1), p(2, 1), p(2, 3)])
  })

  test("the ends of the wire cannot be dragged", () => {
    expect(dragCorner(L, 0, p(9, 9))).toEqual(L)
    expect(dragCorner(L, 2, p(9, 9))).toEqual(L)
  })
})

describe("removeCorner", () => {
  test("drops a corner of a Z and squares the path again", () => {
    expect(removeCorner([p(0, 0), p(0, 1), p(2, 1), p(2, 3)], 1)).toEqual([p(0, 0), p(2, 0), p(2, 3)])
    expect(removeCorner([p(0, 0), p(0, 1), p(2, 1), p(2, 3)], 2)).toEqual([p(0, 0), p(0, 3), p(2, 3)])
  })

  test("the corner of an L is replaced by the other elbow", () => {
    expect(removeCorner([p(0, 0), p(2, 0), p(2, 3)], 1)).toEqual([p(0, 0), p(0, 3), p(2, 3)])
  })

  test("a slanted leg left by old files is squared too", () => {
    expect(removeCorner([p(0, 0), p(1, 1), p(2, 1), p(3, 3)], 2)).toEqual([p(0, 0), p(1, 0), p(1, 3), p(3, 3)])
  })

  test("the ends cannot be removed", () => {
    const L = [p(0, 0), p(2, 0), p(2, 3)]
    expect(removeCorner(L, 0)).toEqual(L)
    expect(removeCorner(L, 2)).toEqual(L)
  })
})

describe("wireOf", () => {
  test("a pin-to-pin wire is a trace written as the connection runs, with both ends fixed", () => {
    const found = wire("wire:R1.pin2|R2.pin1")
    expect(found.points).toEqual([p(0.5, 0), p(1, 1), p(2, 1), p(2.5, 0)])
    expect(found.fixed).toEqual({ start: true, end: true })
    expect(found.writer).toMatchObject({ kind: "trace", toNet: false, reversed: false, components: ["R1", "R2"] })
  })

  test("the n-th wire between a pair is written by the n-th trace between them", () => {
    const second = wire("wire:R1.pin2|R2.pin1#2")
    const first = wire("wire:R1.pin2|R2.pin1")
    if (second.writer.kind !== "trace" || first.writer.kind !== "trace") throw new Error("expected traces")
    expect(second.writer.trace.line).toBeGreaterThan(first.writer.trace.line)
    expect(second.writer.trace.schematicRouteHints).toBeUndefined()
  })

  test("a pin-to-net wire ends at its label and is written with the label end as its last corner", () => {
    const found = wire("wire:R3.pin1|net.VCC")
    expect(found.points).toEqual([p(5.5, 0), p(7, 1), p(7, 2)])
    expect(found.writer).toMatchObject({ kind: "trace", toNet: true, reversed: false })
  })

  test("a trace that names the net first is written in the other order", () => {
    const found = wire("wire:net.VCC|R4.pin1")
    expect(found.points[0]).toEqual(design.schematic.symbols.find((s) => s.pinEnds["R4.pin1"])?.pinEnds["R4.pin1"])
    expect(found.writer).toMatchObject({ kind: "trace", toNet: true, reversed: true })
  })

  test("a wire the engine drew between near pins of a net is written by a new trace between its pins", () => {
    const found = wire("wire:net.GND:1")
    expect(found.writer).toEqual({ kind: "engine", from: "R5.pin1", to: "R6.pin1", components: ["R5", "R6"] })
    expect(found.points.length).toBeGreaterThanOrEqual(2)
  })

  test("an unknown wire is undefined", () => {
    expect(wireOf(design, model, "wire:nothing")).toBeUndefined()
  })
})

describe("wireShapeEdits", () => {
  const Q = p(9, 9)

  test("a pin-to-pin wire sets its interior points on the trace, in the trace's order", () => {
    const found = wire("wire:R1.pin2|R2.pin1")
    const path = dragSegment(found.points, 1, p(0, 0.5))
    expect(wireShapeEdits(design, found, path)).toEqual([
      { kind: "setTraceHints", from: ".R1 > .pin2", to: ".R2 > .pin1", schematicRouteHints: [p(1, 1.5), p(2, 1.5)] },
    ])
  })

  test("a shape that did not change gives no edits", () => {
    const found = wire("wire:R1.pin2|R2.pin1")
    expect(wireShapeEdits(design, found, found.points)).toEqual([])
    expect(wireShapeEdits(design, found, [...found.points.slice(0, 1), p(1, 1), p(1.5, 1), ...found.points.slice(2)])).toEqual([])
  })

  test("a pin-to-net wire keeps its label end as the last corner", () => {
    const found = wire("wire:R3.pin1|net.VCC")
    const path = dragSegment(found.points, 1, p(0.5, 0))
    expect(path).toEqual([p(5.5, 0), p(7.5, 1), p(7.5, 2), p(7, 2)])
    expect(wireShapeEdits(design, found, path)).toEqual([
      { kind: "setTraceHints", from: ".R3 > .pin1", to: "net.VCC", schematicRouteHints: [p(7.5, 1), p(7.5, 2), p(7, 2)] },
    ])
    expect(wireShapeEdits(design, found, [p(5.5, 0), p(5.5, 1), p(7, 1), p(7, 2)])).toEqual([
      { kind: "setTraceHints", from: ".R3 > .pin1", to: "net.VCC", schematicRouteHints: [p(5.5, 1), p(7, 1), p(7, 2)] },
    ])
  })

  test("a trace that names the net first gets its corners reversed, label end first", () => {
    const found = wire("wire:net.VCC|R4.pin1")
    expect(found.points).toEqual([p(-0.5, 3), p(-2, 2), p(-2, 4)])
    const path = dragSegment(found.points, 1, p(-0.5, 0))
    expect(path).toEqual([p(-0.5, 3), p(-2.5, 2), p(-2.5, 4), p(-2, 4)])
    expect(wireShapeEdits(design, found, path)).toEqual([
      { kind: "setTraceHints", from: "net.VCC", to: ".R4 > .pin1", schematicRouteHints: [p(-2, 4), p(-2.5, 4), p(-2.5, 2)] },
    ])
  })

  test("an engine-drawn wire becomes a trace between its two pins with the corners as hints", () => {
    const found = wire("wire:net.GND:1")
    const [a, b] = [found.points[0] as typeof Q, found.points[found.points.length - 1] as typeof Q]
    const path = [a, p(a.x, a.y - 1), p(b.x, a.y - 1), b]
    const edits = wireShapeEdits(design, found, path)
    expect(edits).toEqual([{ kind: "addTrace", from: "R5.pin1", to: "R6.pin1", schematicRouteHints: [p(a.x, a.y - 1), p(b.x, a.y - 1)] }])
  })

  test("a straight engine-drawn wire written as is gives no edits", () => {
    const found = wire("wire:net.GND:1")
    expect(wireShapeEdits(design, found, found.points)).toEqual([])
  })

  test("the written shape is the shape drawn after a rebuild (hand-drawn wire)", () => {
    const found = wire("wire:R1.pin2|R2.pin1")
    const path = dragCorner(found.points, 1, p(1, 2))
    const edits = wireShapeEdits(design, found, path)
    expect(Array.isArray(edits)).toBe(true)
    expect(saved(SOURCE, edits as Edit[], "wire:R1.pin2|R2.pin1").points).toEqual(tidy(path))
  })

  test("the written shape is the shape drawn after a rebuild (wire to a net, reversed trace)", () => {
    const found = wire("wire:net.VCC|R4.pin1")
    const path = dragSegment(found.points, 1, p(0, 0.5))
    const edits = wireShapeEdits(design, found, path)
    expect(saved(SOURCE, edits as Edit[], "wire:net.VCC|R4.pin1").points).toEqual(tidy(path))
  })

  test("the written shape is the shape drawn after a rebuild (engine-drawn wire)", () => {
    const found = wire("wire:net.GND:1")
    const [a, b] = [found.points[0] as typeof Q, found.points[found.points.length - 1] as typeof Q]
    const path = [a, p(a.x, a.y - 1), p(b.x, a.y - 1), b]
    const edits = wireShapeEdits(design, found, path)
    expect(saved(SOURCE, edits as Edit[], "wire:R5.pin1|R6.pin1").points).toEqual(path)
  })

  test("a path whose ends moved is refused", () => {
    const found = wire("wire:R1.pin2|R2.pin1")
    expect(wireShapeEdits(design, found, [p(0, 0), ...found.points.slice(1)])).toEqual({ blocked: "The ends of a wire stay on their pins" })
  })
})

describe("blockers", () => {
  test("a locked part at either end", () => {
    const found = wire("wire:R1.pin2|R2.pin1")
    expect(wireBlocker(design, found, new Set(["R2"]))).toBe("R2 is locked")
    expect(wireShapeEdits(design, found, [found.points[0] as typeof found.points[0], p(1, 3), p(2.5, 3), found.points[3] as typeof found.points[0]], new Set(["R1"]))).toEqual({
      blocked: "R1 is locked",
    })
    expect(wireBlocker(design, wire("wire:net.GND:1"), new Set(["R6"]))).toBe("R6 is locked")
  })

  test("a trace that cannot be edited, and corners written as an expression", () => {
    const looped = setup(SOURCE.replace(`<trace from=".R3 > .pin2" to=".R4 > .pin2" />`, `{[1].map(() => <trace from=".R3 > .pin2" to=".R4 > .pin2" />)}`))
    const found = wire("wire:R3.pin2|R4.pin2", looped.design, looped.model)
    expect(wireBlocker(looped.design, found)).toMatch(/read-only/)

    const expression = setup(SOURCE.replace(`schematicRouteHints={[{ x: 7, y: 1 }, { x: 7, y: 2 }]}`, `schematicRouteHints={hints}`).replace("export default", "const hints = [{ x: 7, y: 1 }, { x: 7, y: 2 }]\nexport default"))
    const wired = wire("wire:R3.pin1|net.VCC", expression.design, expression.model)
    expect(wireBlocker(expression.design, wired)).toBe("The corners of this wire are an expression; change them in the code")
  })

  test("an engine-drawn wire at a part with a repeated name cannot be written", () => {
    const engine = wire("wire:net.GND:1")
    if (engine.writer.kind !== "engine") throw new Error("expected an engine wire")
    const twin: WireShape = { ...engine, writer: { ...engine.writer, unaddressable: "R5~2.pin1 has a repeated name and cannot be wired from the Studio" } }
    expect(wireBlocker(design, twin)).toBe("R5~2.pin1 has a repeated name and cannot be wired from the Studio")
    expect(wireShapeEdits(design, twin, [...engine.points.slice(0, 1), p(0, 9), p(9, 9), ...engine.points.slice(-1)])).toEqual({
      blocked: "R5~2.pin1 has a repeated name and cannot be wired from the Studio",
    })
  })

  test("a wire the engine did not draw from the code has no writer", () => {
    const stray: WireShape = { id: "wire:x", points: [p(0, 0), p(1, 0)], fixed: { start: true, end: true }, writer: { kind: "none", reason: "This wire is not drawn from the code" } }
    expect(wireBlocker(design, stray)).toBe("This wire is not drawn from the code")
  })

  test("nothing blocks an ordinary wire", () => {
    expect(wireBlocker(design, wire("wire:R1.pin2|R2.pin1"))).toBeNull()
    expect(wireBlocker(design, wire("wire:net.GND:1"))).toBeNull()
  })
})

describe("repeated and opposite traces", () => {
  const base = (traces: string) => `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
${traces}
  </board>
)`
  const bump = (found: WireShape) => dragSegment(found.points, 1, p(0, 0.5))

  /** Each wire's points after the edit for `id` is applied through core and the source rebuilt; a refusal gives undefined. */
  function afterEdit(source: string, id: string, others: string[]) {
    const s = setup(source)
    const found = wire(id, s.design, s.model)
    const edits = wireShapeEdits(s.design, found, found.points.length === 2 ? [found.points[0] as typeof Q, p(1, 1), p(2, 1), found.points[1] as typeof Q] : bump(found))
    if (!Array.isArray(edits)) return { blocked: edits.blocked, before: found.points }
    const next = setup(applyEdits(source, edits, new Set()))
    return { before: found.points, after: wire(id, next.design, next.model).points, others: others.map((o) => [wire(o, s.design, s.model).points, wire(o, next.design, next.model).points]) }
  }
  const Q = p(0, 0)

  test("the second of two identical traces is refused and the first lands on itself", () => {
    const source = base(`    <trace from=".R1 > .pin2" to=".R2 > .pin1" />\n    <trace from=".R1 > .pin2" to=".R2 > .pin1" />`)
    expect(afterEdit(source, "wire:R1.pin2|R2.pin1#2", [])).toMatchObject({ blocked: "This wire repeats another between the same ends; change its corners in the code" })
    const first = afterEdit(source, "wire:R1.pin2|R2.pin1", ["wire:R1.pin2|R2.pin1#2"])
    expect(first.blocked).toBeUndefined()
    expect(first.after).not.toEqual(first.before)
    expect(first.others?.[0]?.[1]).toEqual(first.others?.[0]?.[0])
  })

  test("a pin-to-pin pair written both ways: the first lands on itself, the opposite one is refused", () => {
    const source = base(`    <trace from=".R1 > .pin2" to=".R2 > .pin1" />\n    <trace from=".R2 > .pin1" to=".R1 > .pin2" />`)
    const forward = afterEdit(source, "wire:R1.pin2|R2.pin1", ["wire:R2.pin1|R1.pin2"])
    expect(forward.blocked).toBeUndefined()
    expect(forward.others?.[0]?.[1]).toEqual(forward.others?.[0]?.[0])
    expect(afterEdit(source, "wire:R2.pin1|R1.pin2", [])).toMatchObject({ blocked: expect.stringContaining("repeats another") })
  })

  test("a pin-to-net pair written both ways: the opposite one is refused", () => {
    const hints = `schematicRouteHints={[{ x: 1, y: 1 }, { x: 1, y: 2 }]}`
    const source = base(`    <trace from=".R1 > .pin2" to="net.VCC" ${hints} />\n    <trace from="net.VCC" to=".R1 > .pin2" ${hints.replace("x: 1, y: 2", "x: 1, y: 3")} />`)
    const forward = afterEdit(source, "wire:R1.pin2|net.VCC", ["wire:net.VCC|R1.pin2"])
    expect(forward.blocked).toBeUndefined()
    expect(forward.others?.[0]?.[1]).toEqual(forward.others?.[0]?.[0])
    expect(afterEdit(source, "wire:net.VCC|R1.pin2", [])).toMatchObject({ blocked: expect.stringContaining("repeats another") })
  })
})
