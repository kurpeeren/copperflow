import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import { buildDesign } from "../src/engine/design.js"
import { deletePlan } from "../studio/src/pcb/delete-plan.js"
import { drawingsRemoval } from "../studio/src/pcb/drawing-actions.js"
import type { Point } from "../studio/src/pcb/geometry.js"
import { junctionMoves, junctionsGone } from "../studio/src/pcb/junction-follow.js"
import { wiresRemoval } from "../studio/src/pcb/wire-actions.js"
import { draggedPath } from "../studio/src/pcb/wire-drag.js"
import { cornerDrop, wireReshape } from "../studio/src/pcb/wire-reshape.js"
import { Selection } from "../studio/src/selection.js"

const FILE = "main.circuit.tsx"
// R1.pin2 (0.5, 0) to R2.pin1 (2.5, 0) as a U through y = 1, with a junction on its top at (1.5, 1); R3 to R4 straight
// with a junction where the U's wire does not pass.
const SOURCE = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" schX={3} schY={0} />
    <resistor name="R3" resistance="1k" footprint="0402" schX={0} schY={5} />
    <resistor name="R4" resistance="1k" footprint="0402" schX={3} schY={5} />
    <trace from=".R1 > .pin2" to=".R2 > .pin1" schematicRouteHints={[{ x: 0.5, y: 1 }, { x: 2.5, y: 1 }]} />
    <trace from=".R3 > .pin2" to=".R4 > .pin1" />
    <junction x={1.5} y={1} />
    <junction x={1.5} y={5} />
  </board>
)`
const U = "wire:R1.pin2|R2.pin1"
const SNAP = { step: 0.1, snap: true }
const p = (x: number, y: number): Point => ({ x, y })

const setup = (source: string) => ({ design: buildDesign({ [FILE]: source }, FILE), model: { model: analyzeCircuit(source) } })
const { design, model } = setup(SOURCE)
const pointsOf = (id: string): Point[] => (design.schematic.wires.find((wire) => wire.id === id)?.points ?? []).map((q) => p(q.x, q.y))
const junctions = (source: string) => setup(source).design.schematic.drawings.flatMap((d) => (d.kind === "junction" ? [p(d.x, d.y)] : []))

describe("a junction follows its wire", () => {
  test("dragging the wire's segment moves the junction on it, in the same edit list; the other junction stays", () => {
    // The top segment dragged 2 mm down the sheet: from y = 1 to y = 3.
    const path = draggedPath(pointsOf(U), { kind: "segment", index: 1 }, p(0, 2), SNAP)
    const result = wireReshape(design, model, U, path)
    if ("blocked" in result) throw new Error(result.blocked)
    expect(result.edits.filter((edit) => edit.kind === "setDrawingProps")).toHaveLength(1)
    const after = applyEdits(SOURCE, result.edits, new Set())
    expect(setup(after).design.schematic.wires.find((wire) => wire.id === U)?.points.map((q) => q.y)).toEqual([0, 3, 3, 0])
    expect(junctions(after)).toEqual([p(1.5, 3), p(1.5, 5)])
  })

  test("removing the corner the junction sits beside puts it on the new path", () => {
    const result = cornerDrop(design, model, U, 1)
    if ("blocked" in result) throw new Error(result.blocked)
    const moved = result.edits.find((edit) => edit.kind === "setDrawingProps")
    expect(moved).toBeDefined()
    const after = setup(applyEdits(SOURCE, result.edits, new Set())).design
    const wire = after.schematic.wires.find((one) => one.id === U)?.points ?? []
    const [junction] = after.schematic.drawings.filter((d) => d.kind === "junction")
    // On the new path: no wire point segment is further than a rounding step from it.
    expect(junctionsGone([{ id: "j", x: (junction as { x: number }).x, y: (junction as { y: number }).y }], [wire], [])).toEqual(["j"])
  })

  test("a junction another wire also passes through stays where it is", () => {
    const before = [p(0, 0), p(4, 0)]
    const other = [p(2, -1), p(2, 1)]
    expect(junctionMoves([{ id: "j", x: 2, y: 0 }], before, [p(0, 1), p(4, 1)], [other])).toEqual([])
    expect(junctionMoves([{ id: "j", x: 2, y: 0 }], before, [p(0, 1), p(4, 1)], [])).toEqual([{ kind: "setDrawingProps", id: "j", props: { x: 2, y: 1 } }])
  })
})

describe("a junction goes with its wire", () => {
  test("Delete on the wire removes the junction on it in the same change, and leaves the other", () => {
    const removeWires = (ids: readonly string[], parts: ReadonlySet<string>, said: ReadonlySet<string>) => wiresRemoval(design, model, ids, parts, new Set(), said)
    const plan = deletePlan(Selection.none.addWires([U]), () => null, removeWires, undefined, drawingsRemoval(model.model, design.schematic.drawings, new Set()))
    if ("message" in plan) throw new Error(plan.message)
    expect(plan.plan.edits.map((edit) => edit.kind)).toEqual(["removeTrace", "removeDrawing"])
    const after = applyEdits(SOURCE, plan.plan.edits, new Set())
    expect(junctions(after)).toEqual([p(1.5, 5)])
  })
})
