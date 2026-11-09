import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import { buildDesign } from "../src/engine/design.js"
import type { SchematicDrawing } from "../src/engine/model.js"
import { drawingFieldEdit, drawingRows } from "../studio/src/pcb/drawing-props.js"

const FILE = "main.circuit.tsx"
const SOURCE = `export default () => (
  <board width="40mm" height="30mm">
    <schematicrect name="G1" x={1} y={2} width={3} height={1.5} />
    <schematicpath points={[{ x: 0, y: 4 }, { x: 1, y: 4 }]} lineStyle="dashed" />
    <group schX={10} schY={0}>
      <schematiccircle name="G3" x={1} y={1} radius={0.5} filled={true} color="#112233" />
    </group>
    <schematictext name="G2" x={1 + 1} y={1} text="Power" />
    <schematicarc name="G4" radius={1} startAngle={0} endAngle={90} />
    <bus name="D[0:7]" points={[{ x: 0, y: 6 }, { x: 4, y: 6 }]} />
  </board>
)`
const design = buildDesign({ [FILE]: SOURCE }, FILE)
const model = analyzeCircuit(SOURCE)
const drawing = (id: string) => design.schematic.drawings.find((one) => one.id === id) as SchematicDrawing
const info = (id: string) => model.drawings.find((one) => one.id === id)
const rows = (id: string, canEdit = true) => drawingRows(drawing(id), info(id), canEdit)
const brief = (id: string) => rows(id).map((row) => [row.label, row.value])

describe("the rows Properties shows for one drawing", () => {
  test("a rectangle: kind, name, position, size, line, colour and fill", () => {
    expect(brief("G1")).toEqual([
      ["Kind", "Rectangle, line 3"],
      ["Name", "G1"],
      ["X", "1"],
      ["Y", "2"],
      ["Width", "3"],
      ["Height", "1.5"],
      ["Stroke width", "0.01"],
      ["Line style", "solid"],
      ["Colour", ""],
      ["Filled", "false"],
    ])
    expect(rows("G1").find((row) => row.key === "lineStyle")).toMatchObject({ field: "choice", options: ["solid", "dashed", "dotted"], editable: true })
    expect(rows("G1").find((row) => row.key === "color")).toMatchObject({ field: "color", placeholder: "#000080" })
  })

  test("a line: its points, as the file writes them; an unnamed one says so", () => {
    expect(brief("drawing:path:1")).toEqual([
      ["Kind", "Line, line 4"],
      ["Name", "(none)"],
      ["Points", "0, 4; 1, 4"],
      ["Stroke width", "0.01"],
      ["Line style", "dashed"],
      ["Colour", ""],
    ])
  })

  test("a circle in a group shows its own props, not where the group puts it", () => {
    expect(brief("G3")).toEqual([
      ["Kind", "Circle, line 6"],
      ["Name", "G3"],
      ["X", "1"],
      ["Y", "1"],
      ["Radius", "0.5"],
      ["Stroke width", "0.01"],
      ["Line style", "solid"],
      ["Colour", "#112233"],
      ["Filled", "true"],
    ])
  })

  test("an arc: its centre (where the engine puts it when the file leaves it out), radius and angles", () => {
    expect(brief("G4").slice(2, 7)).toEqual([["X", "0"], ["Y", "0"], ["Radius", "1"], ["Start angle", "0"], ["End angle", "90"]])
  })

  test("a text: its text, font size and anchor; a prop written as an expression shows the code and is not a field", () => {
    expect(brief("G2")).toEqual([
      ["Kind", "Text, line 8"],
      ["Name", "G2"],
      ["X", "{1 + 1}"],
      ["Y", "1"],
      ["Text", "Power"],
      ["Font size", "0.1"],
      ["Anchor", "left"],
      ["Colour", ""],
    ])
    expect(rows("G2").find((row) => row.key === "x")).toMatchObject({ editable: false })
    expect(rows("G2").find((row) => row.key === "y")).toMatchObject({ editable: true })
  })

  test("a bus: its name and points", () => {
    expect(brief("D[0:7]")).toEqual([["Kind", "Bus, line 10"], ["Name", "D[0:7]"], ["Points", "0, 6; 4, 6"]])
  })

  test("nothing is a field on a locked or read-only drawing, or one the file lacks", () => {
    expect(rows("G1", false).every((row) => !row.editable)).toBe(true)
    expect(drawingRows(drawing("G1"), undefined, true).every((row) => !row.editable)).toBe(true)
  })
})

describe("a field's edit", () => {
  const applied = (id: string, key: string, text: string) => {
    const result = drawingFieldEdit(drawing(id), key, text)
    if ("message" in result) throw new Error(result.message)
    return { ...result, source: applyEdits(SOURCE, [result.edit], new Set()) }
  }

  test("a number, a choice, a check, a colour and a text each write one setDrawingProps, named for the history", () => {
    expect(applied("G1", "width", "4")).toMatchObject({ edit: { kind: "setDrawingProps", id: "G1", props: { width: 4 } }, summary: "set G1 width=4" })
    expect(applied("G1", "lineStyle", "dotted").edit).toEqual({ kind: "setDrawingProps", id: "G1", props: { lineStyle: "dotted" } })
    expect(applied("G1", "filled", "true").edit).toEqual({ kind: "setDrawingProps", id: "G1", props: { filled: true } })
    expect(applied("G1", "color", "#aa0000").edit).toEqual({ kind: "setDrawingProps", id: "G1", props: { color: "#aa0000" } })
    expect(applied("G2", "text", "Ground").source).toContain('text="Ground"')
  })

  test("points are typed as x, y pairs split by semicolons; the history names the drawing by its words", () => {
    const result = applied("drawing:path:1", "points", "0, 4; 2, 4; 2, 5")
    expect(result.edit).toEqual({ kind: "setDrawingProps", id: "drawing:path:1", props: { points: [{ x: 0, y: 4 }, { x: 2, y: 4 }, { x: 2, y: 5 }] } })
    expect(result.summary).toBe("set the line points")
    expect(buildDesign({ [FILE]: result.source }, FILE).schematic.drawings.find((one) => one.kind === "path")).toMatchObject({ points: [{ x: 0, y: 4 }, { x: 2, y: 4 }, { x: 2, y: 5 }] })
  })

  test("what the engine would refuse is refused here first, with the reason", () => {
    expect(drawingFieldEdit(drawing("G1"), "width", "0")).toEqual({ message: "Width must be a number greater than 0" })
    expect(drawingFieldEdit(drawing("G1"), "x", "a")).toEqual({ message: "X must be a number" })
    expect(drawingFieldEdit(drawing("G1"), "strokeWidth", "-1")).toEqual({ message: "Stroke width must be a number of 0 or more" })
    expect(drawingFieldEdit(drawing("G1"), "lineStyle", "wavy")).toEqual({ message: "Line style must be one of solid, dashed, dotted" })
    expect(drawingFieldEdit(drawing("G1"), "color", "red")).toEqual({ message: 'Colour must be a colour such as "#000080"' })
    expect(drawingFieldEdit(drawing("drawing:path:1"), "points", "0, 4")).toEqual({ message: "Points needs two or more x, y pairs, such as 0, 0; 1, 0" })
    expect(drawingFieldEdit(drawing("G2"), "text", "")).toEqual({ message: "Text cannot be empty" })
  })
})
