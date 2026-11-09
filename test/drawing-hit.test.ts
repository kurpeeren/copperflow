import { describe, expect, test } from "vitest"
import type { SchematicDrawing } from "../src/engine/model.js"
import { boxSelection } from "../studio/src/pcb/box-select.js"
import { drawingAreas, drawingAt, drawingBox, drawingPlace, drawingsInBox } from "../studio/src/pcb/drawing-hit.js"
import { BUS_WIDTH, colorOf, dashOf, drawnWidth, fillOf, strokeWidthOf } from "../studio/src/pcb/drawing-style.js"
import { ALL_PICKABLE } from "../studio/src/pcb/pick-filter.js"
import { schematicTheme } from "../studio/src/pcb/schematic-theme.js"
import { Selection } from "../studio/src/selection.js"

const p = (x: number, y: number) => ({ x, y })
const base = { groupOffset: p(0, 0), source: { file: "main.circuit.tsx", line: 1, column: 1, offset: 0 } }
const stroke = { strokeWidth: 0.01, lineStyle: "solid" as const }

const path = { ...base, ...stroke, id: "G1", kind: "path", points: [p(0, 0), p(2, 0), p(2, 2)] } as SchematicDrawing
const rect = { ...base, ...stroke, id: "G2", kind: "rect", x: 4, y: 0, width: 2, height: 1, filled: false } as SchematicDrawing
const filledRect = { ...rect, id: "G3", filled: true } as SchematicDrawing
const circle = { ...base, ...stroke, id: "G4", kind: "circle", x: 10, y: 0, radius: 1, filled: false } as SchematicDrawing
const arc = { ...base, ...stroke, id: "G5", kind: "arc", x: 14, y: 0, radius: 1, startAngle: 0, endAngle: 90 } as SchematicDrawing
const text = { ...base, id: "G6", kind: "text", x: 20, y: 0, text: "Power", fontSize: 0.2, anchor: "left" } as SchematicDrawing
const bus = { ...base, id: "D[0:7]", name: "D[0:7]", kind: "bus", points: [p(0, 5), p(4, 5)], members: [] } as SchematicDrawing
const REACH = 0.05

describe("hitting a drawing", () => {
  test("a path is hit near any of its segments, not between them", () => {
    expect(drawingPlace(path, p(1, 0.04), REACH)).toBe("line")
    expect(drawingPlace(path, p(2.03, 1), REACH)).toBe("line")
    expect(drawingPlace(path, p(1, 1), REACH)).toBeUndefined()
  })

  test("a rectangle is hit on its outline; inside only when it is filled", () => {
    expect(drawingPlace(rect, p(5, 1.02), REACH)).toBe("line")
    expect(drawingPlace(rect, p(6.03, 0.5), REACH)).toBe("line")
    expect(drawingPlace(rect, p(5, 0.5), REACH)).toBeUndefined()
    expect(drawingPlace(filledRect, p(5, 0.5), REACH)).toBe("inside")
    expect(drawingPlace(filledRect, p(5, 0.02), REACH)).toBe("line")
  })

  test("a circle is hit on its ring; inside only when it is filled", () => {
    expect(drawingPlace(circle, p(11.02, 0), REACH)).toBe("line")
    expect(drawingPlace(circle, p(10, 0), REACH)).toBeUndefined()
    expect(drawingPlace({ ...circle, filled: true } as SchematicDrawing, p(10, 0.2), REACH)).toBe("inside")
  })

  test("an arc is hit on its sweep only, counter-clockwise from its start", () => {
    expect(drawingPlace(arc, p(14 + Math.SQRT1_2, Math.SQRT1_2), REACH)).toBe("line")
    expect(drawingPlace(arc, p(14 - Math.SQRT1_2, -Math.SQRT1_2), REACH)).toBeUndefined()
    expect(drawingPlace(arc, p(15.02, 0), REACH)).toBe("line")
    const wrapped = { ...arc, startAngle: 270, endAngle: 0 } as SchematicDrawing
    expect(drawingPlace(wrapped, p(14 + Math.SQRT1_2, -Math.SQRT1_2), REACH)).toBe("line")
    expect(drawingPlace(wrapped, p(14 + Math.SQRT1_2, Math.SQRT1_2), REACH)).toBeUndefined()
  })

  test("a text is hit anywhere on its box, and within the pointer's reach of it", () => {
    expect(drawingPlace(text, p(20.1, 0.05), REACH)).toBe("line")
    expect(drawingPlace(text, p(19.97, 0), REACH)).toBe("line")
    expect(drawingPlace(text, p(19.9, 0), REACH)).toBeUndefined()
  })

  test("a text too small to be drawn at this zoom cannot be hit", () => {
    expect(drawingAt([text], p(20.1, 0), REACH, 100)).toEqual({ id: "G6", place: "line" })
    expect(drawingAt([text], p(20.1, 0), REACH, 10)).toBeUndefined()
    expect(drawingAt([path], p(1, 0), REACH, 10)).toEqual({ id: "G1", place: "line" })
  })

  test("a bus is hit across its three-wire width", () => {
    expect(drawingPlace(bus, p(2, 5 + BUS_WIDTH / 2 + REACH - 0.001), REACH)).toBe("line")
    expect(drawingPlace(bus, p(2, 5 + BUS_WIDTH / 2 + REACH + 0.001), REACH)).toBeUndefined()
  })

  test("a thick line is hit on its drawn width", () => {
    const thick = { ...path, strokeWidth: 0.2 } as SchematicDrawing
    expect(drawingPlace(thick, p(1, 0.14), REACH)).toBe("line")
    expect(drawingPlace(path, p(1, 0.14), REACH)).toBeUndefined()
  })

  test("drawingAt takes the line drawn last before any fill under the point", () => {
    const over = { ...path, id: "G7", points: [p(4, 0.5), p(6, 0.5)] } as SchematicDrawing
    expect(drawingAt([filledRect, over], p(5, 0.5), REACH)).toEqual({ id: "G7", place: "line" })
    expect(drawingAt([over, filledRect], p(5, 0.52), REACH)).toEqual({ id: "G7", place: "line" })
    expect(drawingAt([over, filledRect], p(5, 0.8), REACH)).toEqual({ id: "G3", place: "inside" })
    expect(drawingAt([path, rect], p(30, 30), REACH)).toBeUndefined()
  })
})

describe("drawings in a selection box", () => {
  const areas = drawingAreas([path, rect, circle, text])

  test("a drawing's box is its shape's grown by half its line", () => {
    expect(drawingBox(rect)).toEqual({ minX: 3.995, minY: -0.005, maxX: 6.005, maxY: 1.005 })
    expect(drawingBox(text)).toEqual({ minX: 20, minY: -0.1, maxX: 20 + 0.6 * 0.2 * 5, maxY: 0.1 })
  })

  test("left to right takes the drawings wholly inside; right to left every one it touches", () => {
    expect(drawingsInBox(areas, p(-1, -1), p(7, 3), "inside")).toEqual(["G1", "G2"])
    expect(drawingsInBox(areas, p(9.5, 0.5), p(5, -0.5), "touching")).toEqual(["G2", "G4"])
  })

  test("the selection after a box holds its drawings, added with Shift or Ctrl, none while the Drawings row is off", () => {
    const before = Selection.none.addDrawings(["G9"])
    expect(boxSelection({ parts: ["R1"], drawings: ["G1"] }, false)(before)).toMatchObject({ names: ["R1"], drawings: ["G1"] })
    expect(boxSelection({ parts: [], drawings: ["G1", "G9"] }, true)(before).drawings).toEqual(["G9", "G1"])
    expect(boxSelection({ parts: ["R1"], drawings: ["G1"] }, false, null, undefined, { ...ALL_PICKABLE, drawings: false })(before)).toMatchObject({ names: ["R1"], drawings: [] })
    expect(boxSelection({ parts: [], drawings: ["G1"] }, false, "note")(before)).toBe(Selection.none)
  })
})

describe("how a drawing looks", () => {
  test("its width, never under a device pixel; a bus three wires wide; a text none", () => {
    expect(strokeWidthOf(path)).toBe(0.01)
    expect(strokeWidthOf(bus)).toBe(0.06)
    expect(strokeWidthOf(text)).toBe(0)
    expect(drawnWidth(0.01, 0.02)).toBe(0.02)
    expect(drawnWidth(0.05, 0.02)).toBe(0.05)
  })

  test("dashes scale with the drawn width", () => {
    expect(dashOf("solid", 0.1)).toEqual([])
    expect(dashOf("dashed", 0.1)).toEqual([0.4, 0.30000000000000004])
    expect(dashOf("dotted", 0.1)).toEqual([0, 0.2])
  })

  test("the theme's drawing colour unless the file gives one; the bus colour for a bus; fills at 20%", () => {
    expect(schematicTheme.drawing).toBe("#000080")
    expect(colorOf(path)).toBe("#000080")
    expect(colorOf({ ...path, color: "#112233" } as SchematicDrawing)).toBe("#112233")
    expect(colorOf(bus)).toBe(schematicTheme.wire)
    expect(fillOf("#000080")).toBe("#00008033")
  })
})
