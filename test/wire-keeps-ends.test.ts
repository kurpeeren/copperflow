import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { keepWireEnds } from "../studio/src/pcb/wire-keeps-ends.js"

const CIRCUIT = `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <resistor name="R2" resistance="1k" footprint="0402" />
    <led name="D1" footprint="0603" />
  </board>
)`

const design = buildDesign({ "main.circuit.tsx": CIRCUIT }, "main.circuit.tsx")
const symbol = (name: string) => design.schematic.symbols.find((s) => s.component === name)
const round = (value: number) => Math.round(value * 100) / 100
const wire = { edits: [{ kind: "addTrace" as const, from: "R1.pin2", to: "R2.pin1", schematicRouteHints: [{ x: 1, y: 0 }] }], summary: "connect R1.pin2 to R2.pin1" }

describe("keepWireEnds", () => {
  test("a wire ending on a part the engine places also writes that part's position, in the same edit", () => {
    const kept = keepWireEnds(design, wire, ["R1.pin2", "R2.pin1"])
    const r2 = symbol("R2")
    expect(kept.edits[0]).toEqual(wire.edits[0])
    expect(kept.edits.slice(1)).toEqual([{ kind: "setProps", part: "R2", props: expect.objectContaining({ schX: round(r2?.x ?? NaN), schY: round(r2?.y ?? NaN) }) }])
    expect(kept.summary).toBe("connect R1.pin2 to R2.pin1, keeping R2 in place")
  })

  test("a part that already has a position, or is not at an end, is left alone", () => {
    const kept = keepWireEnds(design, wire, ["R1.pin2", "net.GND"])
    expect(kept).toEqual(wire)
  })

  test("both ends placed by the engine are both kept, each once", () => {
    const kept = keepWireEnds(design, wire, ["R2.pin1", "D1.anode", "R2.pin2"])
    expect(kept.edits.slice(1).map((edit) => edit.kind === "setProps" && edit.part)).toEqual(["R2", "D1"])
    expect(kept.summary).toBe("connect R1.pin2 to R2.pin1, keeping R2 and D1 in place")
  })

  test("the engine's turn is kept with the position, as Keep these positions does", () => {
    const kept = keepWireEnds(design, wire, ["D1.pin1"])
    const d1 = symbol("D1")
    const props = kept.edits[1]?.kind === "setProps" ? kept.edits[1].props : {}
    expect(props["schRotation"]).toBe(d1?.rotation === 0 ? undefined : d1?.rotation)
  })

  test("a part that may not change (locked, an expression) is left out, and the wire still goes", () => {
    const blocked = (name: string) => (name === "R2" ? "R2 is locked" : null)
    const kept = keepWireEnds(design, wire, ["R1.pin2", "R2.pin1"], { blocked })
    expect(kept).toEqual(wire)
  })

  test("with the source, a part that has schRotation but no position keeps its turn when pinned", () => {
    const source = { model: { parts: [{ name: "R2", props: { schRotation: { literal: 0, editable: true } } }] } } as never
    const kept = keepWireEnds(design, wire, ["R2.pin1"], { source })
    const props = kept.edits[1]?.kind === "setProps" ? kept.edits[1].props : {}
    expect(props).toHaveProperty("schRotation")
  })
})
