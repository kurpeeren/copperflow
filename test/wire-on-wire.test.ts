import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import type { Edit } from "../src/core/types.js"
import { buildDesign } from "../src/engine/design.js"
import { wireProperties } from "../studio/src/pcb/wire-actions.js"
import { wireReshape } from "../studio/src/pcb/wire-reshape.js"
import { dragSegment, tidy, wireBlocker, wireOf, wireShapeEdits, type WireShape } from "../studio/src/pcb/wire-shape.js"

// R5, R6 and R7 are on GND with no wire of their own: Studio routes GND:1 between R5 and R6, then GND:2 from a
// point on GND:1 to R7, since R6's pin has no other way out.
const FILE = "main.circuit.tsx"
const p = (x: number, y: number) => ({ x, y })
const R7_TRACE = `<trace from=".R7 > .pin1" to="net.GND" />`
const SOURCE = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R5" resistance="1k" footprint="0402" schX={0} schY={6} />
    <resistor name="R6" resistance="1k" footprint="0402" schX={3} schY={6} />
    <resistor name="R7" resistance="1k" footprint="0402" schX={6} schY={6} />
    <trace from=".R5 > .pin1" to="net.GND" />
    <trace from=".R6 > .pin1" to="net.GND" />
    ${R7_TRACE}
  </board>
)`
const GND_2 = "wire:net.GND:2"

function setup(source: string) {
  return { design: buildDesign({ [FILE]: source }, FILE), source: { model: analyzeCircuit(source) } }
}

function wireIn(source: string, id: string): WireShape {
  const { design, source: model } = setup(source)
  const found = wireOf(design, model, id)
  if (!found) throw new Error(`no wire ${id}: ${design.schematic.wires.map((w) => w.id).join(", ")}`)
  return found
}

const { design, source } = setup(SOURCE)
const routed = wireIn(SOURCE, GND_2)
const MEET = p(2.3, 6.4)
const R7_PIN = p(5.5, 6)
/** The routed wire with its middle run pulled down to y = 7. */
const pulled = dragSegment(routed.points, 0, p(0, 0.6))

describe("a wire Studio routes from a pin to a wire of its net", () => {
  test("runs from the meeting point on the other wire to its pin", () => {
    expect(routed.points[0]).toEqual(MEET)
    expect(routed.points[routed.points.length - 1]).toEqual(R7_PIN)
  })

  test("is written by the pin's trace to the net, with the meeting point as its last corner", () => {
    expect(routed.writer).toMatchObject({ kind: "engine", from: "R7.pin1", to: "net.GND", components: ["R7"], onWire: { pinLast: true, trace: { from: ".R7 > .pin1", to: "net.GND" } } })
    expect(wireBlocker(design, routed)).toBeNull()
  })

  test("a new shape sets the corners of that trace, from the pin to the meeting point", () => {
    const edits = wireShapeEdits(design, routed, pulled)
    const corners = [...tidy(pulled)].reverse().slice(1)
    expect(edits).toEqual([{ kind: "setTraceHints", from: ".R7 > .pin1", to: "net.GND", schematicRouteHints: corners }])
    expect(corners[corners.length - 1]).toEqual(MEET)
  })

  test("the written shape is the shape drawn after a rebuild, now as the trace's own wire", () => {
    const edits = wireShapeEdits(design, routed, pulled) as Edit[]
    const rebuilt = wireIn(applyEdits(SOURCE, edits, new Set()), "wire:R7.pin1|net.GND")
    expect(rebuilt.points).toEqual([...tidy(pulled)].reverse())
  })

  test("a trace that names the net first gets the corners meeting point first", () => {
    const text = SOURCE.replace(R7_TRACE, `<trace from="net.GND" to=".R7 > .pin1" />`)
    const found = wireIn(text, GND_2)
    const edits = wireShapeEdits(setup(text).design, found, dragSegment(found.points, 0, p(0, 0.6)))
    expect(edits).toEqual([{ kind: "setTraceHints", from: "net.GND", to: ".R7 > .pin1", schematicRouteHints: tidy(pulled).slice(0, -1) }])
  })

  test("without a trace of its own to write, the shape is a new trace from the pin to the net", () => {
    if (routed.writer.kind !== "engine") throw new Error("expected a wire Studio routes")
    const bare: WireShape = { ...routed, writer: { ...routed.writer, onWire: { pinLast: true } } }
    const corners = [...tidy(pulled)].reverse().slice(1)
    expect(wireShapeEdits(design, bare, pulled)).toEqual([{ kind: "addTrace", from: "R7.pin1", to: "net.GND", schematicRouteHints: corners }])
  })

  test("a locked part at its pin blocks it", () => {
    expect(wireBlocker(design, routed, new Set(["R7"]))).toBe("R7 is locked")
  })

  test("Properties names it by its pin and its net, routed by Studio", () => {
    const rows = wireProperties(design, source, GND_2)?.rows.map((row) => [row.label, row.value])
    expect(rows).toEqual([
      ["Net", "GND"],
      ["From", "R7.pin1"],
      ["To", "net GND"],
      ["Corners", String(routed.points.length - 2)],
      ["Kind", "Routed by Studio"],
    ])
  })

  test("after its new shape is built the selection follows it to the trace's wire", () => {
    const reshape = wireReshape(design, source, GND_2, pulled)
    expect(reshape).toMatchObject({ newTrace: true, wire: "wire:R7.pin1|net.GND", summary: "reshape the wire from R7.pin1 to net GND" })
  })
})
