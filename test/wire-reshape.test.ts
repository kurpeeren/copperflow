import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import { buildDesign } from "../src/engine/design.js"
import type { Point } from "../studio/src/pcb/geometry.js"
import { draggedPath } from "../studio/src/pcb/wire-drag.js"
import { cornerDrop, newTraceWireId, reshapeBlocker, sentBlocker, shapesBuilt, wireReshape } from "../studio/src/pcb/wire-reshape.js"
import { removeCorner } from "../studio/src/pcb/wire-shape.js"
import { Selection } from "../studio/src/selection.js"

const FILE = "main.circuit.tsx"

// R1.pin2 (0.5, 0) to R2.pin1 (2.5, 0) as a U through y = 1; R3.pin2 (6.5, 0) to R4.pin1 (8.5, 3) as a Z through x = 7.5;
// R5.pin1 (-0.5, 6, facing right) and R6.pin1 (2.5, 6) on GND, joined by a wire Studio draws on its own; R7.pin2
// (12.5, 0) to R8.pin1 (14.5, 3, facing down) as an L whose elbow the code does not write.
const SOURCE = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <resistor name="R3" resistance="1k" footprint="0402" schX={6} schY={0} />
    <resistor name="R4" resistance="1k" footprint="0402" schX={9} schY={3} />
    <resistor name="R5" resistance="1k" footprint="0402" schX={-1} schY={6} schRotation={180} />
    <resistor name="R6" resistance="1k" footprint="0402" schX={3} schY={6} />
    <resistor name="R7" resistance="1k" footprint="0402" schX={12} schY={0} />
    <resistor name="R8" resistance="1k" footprint="0402" schX={14.5} schY={3.5} schRotation={90} />
    <trace from=".R1 > .pin2" to=".R2 > .pin1" schematicRouteHints={[{ x: 0.5, y: 1 }, { x: 2.5, y: 1 }]} />
    <trace from=".R3 > .pin2" to=".R4 > .pin1" schematicRouteHints={[{ x: 7.5, y: 0 }, { x: 7.5, y: 3 }]} />
    <trace from=".R5 > .pin1" to="net.GND" />
    <trace from=".R6 > .pin1" to="net.GND" />
    <trace from=".R7 > .pin2" to=".R8 > .pin1" />
  </board>
)`

const U = "wire:R1.pin2|R2.pin1"
const Z = "wire:R3.pin2|R4.pin1"
const ENGINE = "wire:net.GND:1"
const L = "wire:R7.pin2|R8.pin1"
const SNAP = { step: 0.1, snap: true }
const p = (x: number, y: number): Point => ({ x, y })

function setup(source = SOURCE) {
  const design = buildDesign({ [FILE]: source }, FILE)
  return { design, model: { model: analyzeCircuit(source) } }
}

const { design, model } = setup()
const pointsOf = (id: string, d = design): Point[] => (d.schematic.wires.find((wire) => wire.id === id)?.points ?? []).map((q) => p(q.x, q.y))

/** The sheet after the edits are written and the design rebuilt. */
function rebuilt(result: ReturnType<typeof wireReshape>) {
  if ("blocked" in result) throw new Error(result.blocked)
  return setup(applyEdits(SOURCE, result.edits, new Set())).design
}

describe("the edit a segment drag sends", () => {
  test("new corners on the wire's trace, in one edit, with a line for the history; the wire keeps its id", () => {
    expect(pointsOf(U)).toEqual([p(0.5, 0), p(0.5, 1), p(2.5, 1), p(2.5, 0)])
    const path = draggedPath(pointsOf(U), { kind: "segment", index: 1 }, p(0.2, 0.52), SNAP)
    const result = wireReshape(design, model, U, path)
    expect(result).toEqual({
      edits: [{ kind: "setTraceHints", from: ".R1 > .pin2", to: ".R2 > .pin1", schematicRouteHints: [p(0.5, 1.5), p(2.5, 1.5)] }],
      summary: "reshape the wire from R1.pin2 to R2.pin1",
      points: [p(0.5, 0), p(0.5, 1.5), p(2.5, 1.5), p(2.5, 0)],
      newTrace: false,
      wire: U,
    })
    expect(pointsOf(U, rebuilt(result))).toEqual([p(0.5, 0), p(0.5, 1.5), p(2.5, 1.5), p(2.5, 0)])
  })

  test("a wire Studio drew on its own becomes a trace of its own between its two pins, with the shape; it is then named by that trace", () => {
    expect(pointsOf(ENGINE)).toEqual([p(-0.5, 6), p(2.5, 6)])
    const path = draggedPath(pointsOf(ENGINE), { kind: "segment", index: 0 }, p(0, 0.5), SNAP)
    const result = wireReshape(design, model, ENGINE, path)
    expect(result).toEqual({
      edits: [{ kind: "addTrace", from: "R5.pin1", to: "R6.pin1", schematicRouteHints: [p(-0.5, 6.5), p(2.5, 6.5)] }],
      summary: "reshape the wire from R5.pin1 to R6.pin1",
      points: [p(-0.5, 6), p(-0.5, 6.5), p(2.5, 6.5), p(2.5, 6)],
      newTrace: true,
      wire: "wire:R5.pin1|R6.pin1",
    })
    expect(pointsOf("wire:R5.pin1|R6.pin1", rebuilt(result))).toEqual([p(-0.5, 6), p(-0.5, 6.5), p(2.5, 6.5), p(2.5, 6)])
  })

  test("a shape that did not change sends nothing", () => {
    expect(wireReshape(design, model, U, pointsOf(U))).toMatchObject({ edits: [] })
  })

  test("it is compared with the shape shown: a drag back to the built shape while a new one waits for its build restores the built corners", () => {
    const shown = [p(0.5, 0), p(0.5, 1.5), p(2.5, 1.5), p(2.5, 0)]
    expect(wireReshape(design, model, U, pointsOf(U), undefined, shown)).toMatchObject({
      edits: [{ kind: "setTraceHints", from: ".R1 > .pin2", to: ".R2 > .pin1", schematicRouteHints: [p(0.5, 1), p(2.5, 1)] }],
      points: pointsOf(U),
    })
    expect(wireReshape(design, model, U, shown, undefined, shown)).toMatchObject({ edits: [] })
  })

  test("a blocked wire, or one gone from the sheet, says why and sends nothing", () => {
    const path = draggedPath(pointsOf(U), { kind: "segment", index: 1 }, p(0, 0.5), SNAP)
    expect(wireReshape(design, model, U, path, new Set(["R2"]))).toEqual({ blocked: "R2 is locked" })
    expect(wireReshape(design, model, "wire:nothing", path)).toEqual({ blocked: "This wire is no longer on the sheet" })
  })

  test("the reason a drag is refused up front is the one the edit would give", () => {
    expect(reshapeBlocker(design, model, U)).toBeNull()
    expect(reshapeBlocker(design, model, ENGINE)).toBeNull()
    expect(reshapeBlocker(design, model, U, new Set(["R1"]))).toBe("R1 is locked")
    expect(reshapeBlocker(design, model, "wire:nothing")).toBe("This wire is no longer on the sheet")
  })
})

describe("a wire whose new shape is on its way", () => {
  const WAIT = "This wire's new trace is still being built; reshape it again when the build is done"

  test("a wire Studio drew on its own waits for its new trace before another shape, which would add a second trace", () => {
    expect(sentBlocker([{ id: ENGINE, newTrace: true, wire: "wire:R5.pin1|R6.pin1" }], ENGINE)).toBe(WAIT)
    // Even when the new trace's wire could not be named.
    expect(sentBlocker([{ id: ENGINE, newTrace: true }], ENGINE)).toBe(WAIT)
  })

  test("a trace's wire may be reshaped again at once: its corners are written whole each time", () => {
    expect(sentBlocker([{ id: U, newTrace: false, wire: U }], U)).toBeNull()
    expect(sentBlocker([{ id: ENGINE, newTrace: true, wire: "wire:R5.pin1|R6.pin1" }], U)).toBeNull()
  })
})

describe("the wire a new trace will have", () => {
  const connection = (from: string, to: string, n = 1) => ({ id: n === 1 ? `${from}|${to}` : `${from}|${to}#${n}`, from, to })

  test("is named as the engine names the connection: its pins in written order, with #n after traces between them the same way", () => {
    expect(newTraceWireId([], "R5.pin1", "R6.pin1")).toBe("wire:R5.pin1|R6.pin1")
    expect(newTraceWireId([connection("R5.pin1", "R6.pin1")], "R5.pin1", "R6.pin1")).toBe("wire:R5.pin1|R6.pin1#2")
    expect(newTraceWireId([connection("R5.pin1", "R6.pin1"), connection("R5.pin1", "R6.pin1", 2)], "R5.pin1", "R6.pin1")).toBe("wire:R5.pin1|R6.pin1#3")
    expect(newTraceWireId([connection("R6.pin1", "R5.pin1")], "R5.pin1", "R6.pin1")).toBe("wire:R5.pin1|R6.pin1")
  })
})

describe("when the build with a new shape arrives", () => {
  const NEW = "wire:R5.pin1|R6.pin1"
  const sent = [
    { id: ENGINE, newTrace: true, wire: NEW, sentAt: 100 },
    { id: U, newTrace: false, wire: U, sentAt: 100 },
    { id: Z, newTrace: false, wire: Z, sentAt: 300 },
  ]

  test("the shapes it includes are done; a later one keeps waiting", () => {
    expect(shapesBuilt(sent, 200, new Set([NEW, U, Z])).waiting).toEqual([sent[2]])
    expect(shapesBuilt(sent, 50, new Set()).waiting).toBe(sent)
  })

  test("a wire Studio drew on its own, still selected, passes the selection to its new trace's wire", () => {
    const { follow } = shapesBuilt(sent, 200, new Set([NEW, U, Z]))
    expect(follow(Selection.none.onlyWire(ENGINE)).wires).toEqual([NEW])
    const u = Selection.none.onlyWire(U)
    expect(follow(u)).toBe(u)
    const parts = Selection.none.only("R1")
    expect(follow(parts)).toBe(parts)
  })

  test("among parts and other wires, the wire Studio drew is renamed in its place and the rest stay", () => {
    const { follow } = shapesBuilt(sent, 200, new Set([NEW, U, Z]))
    expect(follow(Selection.none.only("R1").addWires([U, ENGINE, Z]))).toMatchObject({ names: ["R1"], wires: [U, NEW, Z] })
  })

  test("the selected labels stay when a wire is renamed", () => {
    const { follow } = shapesBuilt(sent, 200, new Set([NEW, U, Z]))
    expect(follow(Selection.none.addWires([ENGINE]).addLabels(["label:A", "label:B"]))).toMatchObject({ wires: [NEW], labels: ["label:A", "label:B"] })
  })

  test("nothing is passed on when the sheet does not draw the new wire (the build failed), or it could not be named", () => {
    const { follow } = shapesBuilt(sent, 200, new Set([U, Z]))
    const engine = Selection.none.onlyWire(ENGINE)
    expect(follow(engine)).toBe(engine)
    const unnamed = shapesBuilt([{ id: ENGINE, newTrace: true, sentAt: 100 }], 200, new Set([NEW]))
    expect(unnamed.follow(engine)).toBe(engine)
  })
})

describe("the edit a corner drag sends", () => {
  test("the corner moves, its segments stay square, and the end it touches gets a jog", () => {
    expect(pointsOf(Z)).toEqual([p(6.5, 0), p(7.5, 0), p(7.5, 3), p(8.5, 3)])
    const path = draggedPath(pointsOf(Z), { kind: "corner", index: 2 }, p(0.52, 0.48), SNAP)
    const result = wireReshape(design, model, Z, path)
    expect(result).toMatchObject({
      edits: [{ kind: "setTraceHints", from: ".R3 > .pin2", to: ".R4 > .pin1", schematicRouteHints: [p(8, 0), p(8, 3.5), p(8.5, 3.5)] }],
      summary: "reshape the wire from R3.pin2 to R4.pin1",
    })
    expect(pointsOf(Z, rebuilt(result))).toEqual([p(6.5, 0), p(8, 0), p(8, 3.5), p(8.5, 3.5), p(8.5, 3)])
  })
})

describe("a double click on a corner handle", () => {
  test("removes that corner in one edit, as Remove corner would square the path", () => {
    const result = cornerDrop(design, model, Z, 1)
    const expected = removeCorner(pointsOf(Z), 1)
    expect(expected.length).toBeLessThan(4)
    expect(result).toEqual({
      edits: [{ kind: "setTraceHints", from: ".R3 > .pin2", to: ".R4 > .pin1", schematicRouteHints: expected.slice(1, -1) }],
      summary: "remove a corner of the wire from R3.pin2 to R4.pin1",
      points: expected,
      newTrace: false,
      wire: Z,
    })
    expect(pointsOf(Z, rebuilt(result))).toEqual(expected)
  })

  test("while a new shape waits for its build, the corner is taken from the shape shown", () => {
    const shown = [p(6.5, 0), p(8, 0), p(8, 3.5), p(8.5, 3.5), p(8.5, 3)]
    const expected = removeCorner(shown, 3)
    const result = cornerDrop(design, model, Z, 3, undefined, shown)
    expect(result).toMatchObject({ edits: [{ kind: "setTraceHints", schematicRouteHints: expected.slice(1, -1) }], points: expected })
    expect(pointsOf(Z, rebuilt(result))).toEqual(expected)
  })

  test("an elbow the code does not write refuses as Remove corners does, and writes nothing", () => {
    expect(pointsOf(L)).toEqual([p(12.5, 0), p(14.5, 0), p(14.5, 3)])
    expect(cornerDrop(design, model, L, 1)).toEqual({ blocked: "Studio draws this wire's corner; the code has none to remove" })
    expect(cornerDrop(design, model, ENGINE, 1)).toEqual({ blocked: "This wire has no trace of its own: Studio draws it for net GND" })
  })

  test("an end is not a corner: nothing is sent", () => {
    expect(cornerDrop(design, model, Z, 0)).toMatchObject({ edits: [] })
    expect(cornerDrop(design, model, Z, 3)).toMatchObject({ edits: [] })
  })

  test("a locked end says why", () => {
    expect(cornerDrop(design, model, Z, 1, new Set(["R3"]))).toEqual({ blocked: "R3 is locked" })
  })
})
