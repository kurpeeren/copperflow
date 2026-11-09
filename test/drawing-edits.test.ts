import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { nextDrawingName } from "../src/core/drawing-names.js"
import { applyEdits, EditError } from "../src/core/edit.js"
import type { Edit } from "../src/core/types.js"
import { DRAWINGS } from "./fixtures.js"

const none = new Set<string>()
const TWO = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
]
const ids = (source: string) => analyzeCircuit(source).drawings.map((d) => d.id)

function editError(edits: Edit[], locked: ReadonlySet<string> = none, source = DRAWINGS): EditError {
  try {
    applyEdits(source, edits, locked)
  } catch (error) {
    expect(error).toBeInstanceOf(EditError)
    return error as EditError
  }
  throw new Error("expected an EditError")
}

describe("addDrawing", () => {
  test("adds a drawing before the board's first trace, its name first", () => {
    const out = applyEdits(DRAWINGS, [{ kind: "addDrawing", tag: "schematiccircle", name: "G3", props: { x: 1, y: -2, radius: 0.5, filled: true } }], none)
    expect(out).toBe(
      DRAWINGS.replace(
        '    <trace from=".R1',
        '    <schematiccircle name="G3" x={1} y={-2} radius={0.5} filled={true} />\n    <trace from=".R1',
      ),
    )
  })

  test("writes points as a literal list, rounded as wire corners are", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1.234567, y: -2 },
    ]
    const out = applyEdits(DRAWINGS, [{ kind: "addDrawing", tag: "schematicpath", name: "G3", props: { points, lineStyle: "dashed" } }], none)
    expect(out).toContain('    <schematicpath name="G3" points={[{ x: 0, y: 0 }, { x: 1.2346, y: -2 }]} lineStyle="dashed" />\n    <trace')
  })

  test("an unnamed drawing takes the next place among its kind", () => {
    const out = applyEdits(DRAWINGS, [{ kind: "addDrawing", tag: "schematicpath", props: { points: TWO } }], none)
    expect(ids(out)).toContain("drawing:path:3")
  })

  test("a bus needs a name that names its nets, and a new piece may share an existing bus's name", () => {
    expect(editError([{ kind: "addDrawing", tag: "bus", props: { points: TWO } }]).code).toBe("invalid")
    expect(editError([{ kind: "addDrawing", tag: "bus", name: "D[3]", props: { points: TWO } }]).code).toBe("invalid")
    const out = applyEdits(DRAWINGS, [{ kind: "addDrawing", tag: "bus", name: "D[0:7]", props: { points: TWO } }], none)
    expect(ids(out)).toContain("D[0:7]~3")
  })

  test("refuses a name a part or another drawing has, and names that are not names", () => {
    for (const [tag, name] of [
      ["schematiccircle", "R1"],
      ["schematiccircle", "G1"],
      ["bus", "G1"],
      ["schematicrect", "D[0:7]"],
      ["schematicrect", "bad name"],
      ["schematicrect", "drawing:rect:9"],
    ] as const) {
      const error = editError([{ kind: "addDrawing", tag, name, props: { x: 0 } }])
      expect([name, error.code]).toEqual([name, "invalid"])
    }
    expect(editError([{ kind: "addDrawing", tag: "schematiccircle", name: "G1", props: { radius: 1 } }]).message).toBe("A drawing named G1 already exists")
  })

  test("refuses other tags, a name among the props and values it cannot write", () => {
    const bad: Edit[] = [
      { kind: "addDrawing", tag: "resistor", props: { x: 0 } },
      { kind: "addDrawing", tag: "schematicrect", props: { name: "G5" } },
      { kind: "addDrawing", tag: "schematicrect", props: { "bad-key": 1 } },
      { kind: "addDrawing", tag: "schematicrect", props: { x: Number.NaN } },
      { kind: "addDrawing", tag: "schematicpath", props: { points: [{ x: 0, y: 0 }] } },
      { kind: "addDrawing", tag: "schematicpath", props: { points: "0,0 1,1" } },
      { kind: "addDrawing", tag: "schematicpath", props: { points: [{ x: 0, y: 0 }, { x: Number.POSITIVE_INFINITY, y: 0 }] } },
      { kind: "addDrawing", tag: "schematicrect", props: { x: TWO } },
    ]
    for (const edit of bad) expect([edit, editError([edit]).code]).toEqual([edit, "invalid"])
  })

  test("needs a board with a closing tag", () => {
    expect(editError([{ kind: "addDrawing", tag: "schematicrect", props: { width: 1 } }], none, "const x = <group />").code).toBe("invalid")
  })
})

describe("removeDrawing", () => {
  test("removes the drawing's line and nothing else", () => {
    const out = applyEdits(DRAWINGS, [{ kind: "removeDrawing", id: "drawing:path:1" }], none)
    expect(out).toBe(DRAWINGS.replace("    <schematicpath points={[{ x: 0, y: 0 }, { x: 1, y: 0 }]} strokeWidth={0.02} />\n", ""))
  })

  test("removes one piece of a bus", () => {
    const out = applyEdits(DRAWINGS, [{ kind: "removeDrawing", id: "D[0:7]~2" }], none)
    expect(out).toBe(DRAWINGS.replace('    <bus name="D[0:7]" points={[{ x: 4, y: 3 }, { x: 4, y: 5 }]} />\n', ""))
  })

  test("refuses unknown ids, locked drawings and read-only ones", () => {
    expect(editError([{ kind: "removeDrawing", id: "G99" }]).code).toBe("not_found")
    expect(editError([{ kind: "removeDrawing", id: "G1" }], new Set(["G1"]))).toMatchObject({ code: "locked", message: "G1 is locked; ask the human to unlock it" })
    const mapped = `<board>\n  {[1].map(() => <schematicrect name="B" width={1} height={1} />)}\n</board>`
    expect(editError([{ kind: "removeDrawing", id: "B" }], none, mapped)).toMatchObject({ code: "readonly", message: "B is read-only (inside a callback such as .map())" })
  })

  test("refuses to shift the id of a locked unnamed drawing", () => {
    const error = editError([{ kind: "removeDrawing", id: "drawing:path:1" }], new Set(["drawing:path:2"]))
    expect(error).toMatchObject({ code: "locked", message: "The edit would change the locked drawing drawing:path:2; ask the human to unlock it" })
  })
})

describe("setDrawingProps", () => {
  test("moves a rectangle by its corner", () => {
    const out = applyEdits(DRAWINGS, [{ kind: "setDrawingProps", id: "G1", props: { x: 2, y: 3.5 } }], none)
    expect(out).toBe(DRAWINGS.replace("x={1} y={2} width", "x={2} y={3.5} width"))
  })

  test("moves a polyline by its points", () => {
    const points = [
      { x: 0.5, y: 1 },
      { x: 1.5, y: 1 },
    ]
    const out = applyEdits(DRAWINGS, [{ kind: "setDrawingProps", id: "drawing:path:2", props: { points } }], none)
    expect(out).toBe(DRAWINGS.replace("points={[{ x: 0, y: 1 }, { x: 1, y: 1 }]}", "points={[{ x: 0.5, y: 1 }, { x: 1.5, y: 1 }]}"))
  })

  test("restyles: replaces the props it has and adds the ones it lacks", () => {
    const out = applyEdits(DRAWINGS, [{ kind: "setDrawingProps", id: "drawing:path:1", props: { strokeWidth: 0.03, lineStyle: "dotted", color: "#112233" } }], none)
    expect(out).toContain('<schematicpath points={[{ x: 0, y: 0 }, { x: 1, y: 0 }]} strokeWidth={0.03} lineStyle="dotted" color="#112233" />')
  })

  test("renames a drawing to a free name", () => {
    const out = applyEdits(DRAWINGS, [{ kind: "setDrawingProps", id: "drawing:path:1", props: { name: "G7" } }], none)
    expect(out).toContain('strokeWidth={0.02} name="G7" />')
    expect(ids(applyEdits(DRAWINGS, [{ kind: "setDrawingProps", id: "D[0:7]~2", props: { name: "A[0:3]" } }], none))).toContain("A[0:3]")
    expect(editError([{ kind: "setDrawingProps", id: "G2", props: { name: "R1" } }]).code).toBe("invalid")
    expect(editError([{ kind: "setDrawingProps", id: "G2", props: { name: "G1" } }]).code).toBe("invalid")
  })

  test("refuses a prop written as an expression, in the usual words", () => {
    expect(editError([{ kind: "setDrawingProps", id: "G2", props: { x: 2 } }])).toMatchObject({
      code: "readonly",
      message: "G2.x is an expression ({1 + 1}) and cannot be edited",
    })
    const source = `<board>\n  <schematicpath name="P" points={corners} />\n</board>`
    expect(editError([{ kind: "setDrawingProps", id: "P", props: { points: TWO } }], none, source)).toMatchObject({
      code: "readonly",
      message: "P.points is an expression ({corners}) and cannot be edited",
    })
    expect(applyEdits(DRAWINGS, [{ kind: "setDrawingProps", id: "G2", props: { y: 2 } }], none)).toContain("x={1 + 1} y={2}")
  })

  test("refuses locked and unknown drawings and values it cannot write", () => {
    expect(editError([{ kind: "setDrawingProps", id: "G1", props: { x: 2 } }], new Set(["G1"])).code).toBe("locked")
    expect(editError([{ kind: "setDrawingProps", id: "R1", props: { x: 2 } }]).code).toBe("not_found")
    expect(editError([{ kind: "setDrawingProps", id: "G1", props: { x: Number.NaN } }]).code).toBe("invalid")
    expect(editError([{ kind: "setDrawingProps", id: "G1", props: { x: TWO } }]).code).toBe("invalid")
    expect(editError([{ kind: "setDrawingProps", id: "drawing:path:1", props: { points: [] } }]).code).toBe("invalid")
  })

  test("parts and drawings are not confused", () => {
    expect(editError([{ kind: "setProps", part: "G1", props: { x: 2 } }]).code).toBe("not_found")
    expect(editError([{ kind: "removePart", part: "G1" }]).code).toBe("not_found")
    expect(editError([{ kind: "addPart", tag: "resistor", name: "G1" }])).toMatchObject({ code: "invalid", message: "A drawing named G1 already exists" })
  })
})

describe("nextDrawingName", () => {
  test("is G and the number after the highest one taken", () => {
    expect(nextDrawingName(analyzeCircuit(DRAWINGS))).toBe("G3")
    expect(nextDrawingName(analyzeCircuit("<board></board>"))).toBe("G1")
  })

  test("counts parts and buses named that way too", () => {
    const source = `<board>\n  <resistor name="G4" />\n  <bus name="G7" points={[{ x: 0, y: 0 }, { x: 1, y: 0 }]} />\n  <schematicrect name="G10x" />\n</board>`
    expect(nextDrawingName(analyzeCircuit(source))).toBe("G8")
  })
})
