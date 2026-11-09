import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import type { Edit } from "../src/core/types.js"
import { buildDesign } from "../src/engine/design.js"
import type { SchematicDrawing } from "../src/engine/model.js"
import { deletePlan } from "../studio/src/pcb/delete-plan.js"
import { drawingBlocker, drawingMoves, drawingOrigin, drawingsRemoval } from "../studio/src/pcb/drawing-actions.js"
import { moveWithWires, type GestureInput } from "../studio/src/pcb/gestures.js"
import type { GroupEditActions } from "../studio/src/pcb/group-edits.js"
import { keySession, type EditInput } from "../studio/src/pcb/key-session.js"
import { previewMoving, type MovePreview } from "../studio/src/pcb/move-preview.js"
import { moveBlocker, partAnchors } from "../studio/src/pcb/positions.js"
import { sheetBoxes } from "../studio/src/pcb/schematic-draw.js"
import { Selection } from "../studio/src/selection.js"

const FILE = "main.circuit.tsx"
const p = (x: number, y: number) => ({ x, y })

const SOURCE = `export default () => (
  <board width="40mm" height="30mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} />
    <schematicrect name="G1" x={1} y={2} width={3} height={1.5} />
    <schematicpath points={[{ x: 0, y: 4 }, { x: 1, y: 4 }]} />
    <group schX={10} schY={0}>
      <schematiccircle name="G3" x={1} y={1} radius={0.5} />
    </group>
    <schematictext name="G2" x={1 + 1} y={1} text="Power" />
    <schematicarc name="G4" radius={1} startAngle={0} endAngle={90} />
    <bus name="D[0:7]" points={[{ x: 0, y: 6 }, { x: 4, y: 6 }]} />
  </board>
)`

const PATH = "drawing:path:1"
const design = buildDesign({ [FILE]: SOURCE }, FILE)
const source = { model: analyzeCircuit(SOURCE) }
const sheet = design.schematic.drawings
const drawn = (on: typeof design, id: string) => on.schematic.drawings.find((drawing) => drawing.id === id) as SchematicDrawing
const rebuilt = (edits: readonly Edit[], locked: ReadonlySet<string> = new Set()) => buildDesign({ [FILE]: applyEdits(SOURCE, [...edits], locked) }, FILE)
/** A drawing without where its text sits in the file, which a move's longer numbers shift. */
const shape = (drawing: SchematicDrawing | undefined) => drawing && { ...drawing, source: undefined }
const moves = (ids: string[], offset = p(0.5, -1), locked: ReadonlySet<string> = new Set()) => drawingMoves(source.model, sheet, ids, offset, locked)

describe("what may move or go", () => {
  test("a drawing in the file may; a locked one, a read-only one or one the file lacks may not", () => {
    expect(drawingBlocker(source.model, new Set(), "G1")).toBeNull()
    expect(drawingBlocker(source.model, new Set(["G1"]), "G1")).toBe("G1 is locked")
    expect(drawingBlocker(source.model, new Set(), "G9")).toBe("G9 has no editable source element")
  })

  test("a move needs its position props as literals", () => {
    expect(drawingBlocker(source.model, new Set(), "G2", ["x", "y"])).toBe("G2.x is an expression; change it in the code")
    expect(drawingBlocker(source.model, new Set(), "G4", ["x", "y"])).toBeNull()
  })

  test("the origin a drag snaps: a shape's x and y, a line's first point, on the sheet", () => {
    expect(drawingOrigin(drawn(design, "G1"))).toEqual(p(1, 2))
    expect(drawingOrigin(drawn(design, "G3"))).toEqual(p(11, 1))
    expect(drawingOrigin(drawn(design, PATH))).toEqual(p(0, 4))
  })
})

describe("moving drawings", () => {
  test("a shape moves by its x and y, a line by its points; the build puts each where the preview drew it", () => {
    const { edits, shown } = moves(["G1", PATH])
    expect(edits).toEqual([
      { kind: "setDrawingProps", id: "G1", props: { x: 1.5, y: 1 } },
      { kind: "setDrawingProps", id: PATH, props: { points: [p(0.5, 3), p(1.5, 3)] } },
    ])
    const after = rebuilt(edits)
    for (const drawing of shown) expect(shape(drawn(after, drawing.id))).toEqual(shape(drawing))
  })

  test("a drawing in a group writes its own props; the preview adds the group's offset", () => {
    const { edits, shown } = moves(["G3"])
    expect(edits).toEqual([{ kind: "setDrawingProps", id: "G3", props: { x: 1.5, y: 0 } }])
    expect(shown[0]).toMatchObject({ id: "G3", x: 11.5, y: 0 })
    expect(shape(drawn(rebuilt(edits), "G3"))).toEqual(shape(shown[0]))
  })

  test("a shape with no x or y moves from where the engine puts it", () => {
    const { edits } = moves(["G4"])
    expect(edits).toEqual([{ kind: "setDrawingProps", id: "G4", props: { x: 0.5, y: -1 } }])
  })

  test("a bus moves its points like a line", () => {
    const { edits } = moves(["D[0:7]"], p(0, 1))
    expect(edits).toEqual([{ kind: "setDrawingProps", id: "D[0:7]", props: { points: [p(0, 7), p(4, 7)] } }])
  })

  test("one that may not move is named and left; the history names one by its name and several by their count", () => {
    expect(moves(["G2"])).toMatchObject({ edits: [], names: [], skipped: ["G2.x is an expression; change it in the code"] })
    expect(moves(["G1"], p(1, 0), new Set(["G1"]))).toMatchObject({ edits: [], skipped: ["G1 is locked"] })
    expect(moves(["G1"]).names).toEqual(["G1"])
    expect(moves([PATH]).names).toEqual(["the line"])
    expect(moves(["G1", PATH, "G3"]).names).toEqual(["3 drawings"])
  })
})

describe("drawings moved with a selection", () => {
  const input = {
    view: "schematic",
    circuit: source,
    anchors: partAnchors(design, "schematic"),
    boxes: sheetBoxes(design.schematic),
    blockerFor: (name: string) => moveBlocker(source, new Set(), name, "schematic"),
    follow: { design, locked: new Set<string>() },
  } as unknown as GestureInput

  test("parts and drawings move in one edit list, named together in the history", () => {
    const { plan, drawings } = moveWithWires(input, ["R1"], p(0.5, -1), [], [], ["G1", PATH])
    expect(plan.edits.map((edit) => edit.kind)).toEqual(["setProps", "setDrawingProps", "setDrawingProps"])
    expect(plan.summary).toBe("move R1 and 2 drawings in the schematic by (0.5, -1)")
    expect(drawings.map((drawing) => drawing.id)).toEqual(["G1", PATH])
  })

  test("a drawing alone moves; one that cannot is named in the note", () => {
    const alone = moveWithWires(input, [], p(0, 1), [], [], ["G1"])
    expect(alone.plan.summary).toBe("move G1 in the schematic by (0, 1)")
    expect(alone.plan.edits).toEqual([{ kind: "setDrawingProps", id: "G1", props: { x: 1, y: 3 } }])
    const refused = moveWithWires(input, ["R1"], p(0, 1), [], [], ["G2"])
    expect(refused.plan.skipped).toEqual(["G2.x is an expression; change it in the code"])
    expect(refused.plan.summary).toBe("move R1 in the schematic to (0, 1)")
  })
})

describe("drawings moved by the arrow keys", () => {
  test("an arrow press moves the selected drawings with the parts in one edit, and the preview draws them moved", async () => {
    const calls: { edits: Edit[]; summary: string }[] = []
    const actions: GroupEditActions = { edit: async (edits, summary) => (calls.push({ edits, summary }), true), notify: () => undefined }
    const previews: MovePreview[] = []
    const session = keySession({ resolved: () => undefined, holding: () => undefined, moved: (preview) => void previews.push(preview) })
    const edit: EditInput = {
      view: "schematic",
      selection: Selection.none.all(["R1"], [], [], ["G1"]),
      circuit: source,
      actions,
      blockerFor: (name) => moveBlocker(source, new Set(), name, "schematic"),
      layout: { anchors: partAnchors(design, "schematic"), boxes: sheetBoxes(design.schematic), step: 0.5 },
      builtMark: 0,
      buildStatus: "done",
      moveWaiting: false,
      follow: { design, locked: new Set() },
    }
    session.nudge(edit, { action: "nudgeUp", preventDefault: true, steps: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual([{ edits: [{ kind: "setProps", part: "R1", props: { schX: 0, schY: 0.5 } }, { kind: "setDrawingProps", id: "G1", props: { x: 1, y: 2.5 } }], summary: "move R1 and G1 in the schematic by (0, 0.5)" }])
    expect(previewMoving(previews[0] as MovePreview, partAnchors(design, "schematic")).drawings).toMatchObject([{ id: "G1", x: 1, y: 2.5 }])
  })

  test("an arrow press with only a drawing selected moves it", async () => {
    const calls: Edit[][] = []
    const actions: GroupEditActions = { edit: async (edits) => (calls.push(edits), true), notify: () => undefined }
    const session = keySession({ resolved: () => undefined, holding: () => undefined })
    const layout = { anchors: partAnchors(design, "schematic"), boxes: sheetBoxes(design.schematic), step: 0.5 }
    const edit: EditInput = { view: "schematic", selection: Selection.none.onlyDrawing(PATH), circuit: source, actions, blockerFor: () => null, layout, builtMark: 0, buildStatus: "done", moveWaiting: false, follow: { design, locked: new Set() } }
    session.nudge(edit, { action: "nudgeLeft", preventDefault: true, steps: 1 })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toEqual([[{ kind: "setDrawingProps", id: PATH, props: { points: [p(-0.5, 4), p(0.5, 4)] } }]])
  })
})

describe("deleting drawings", () => {
  const remove = (selection: Selection, locked: ReadonlySet<string> = new Set()) =>
    deletePlan(selection, (name) => moveBlocker(source, locked, name, "schematic"), undefined, undefined, drawingsRemoval(source.model, sheet, locked))

  test("each selected drawing that may go is removed, in one change, without a question", () => {
    const result = remove(Selection.none.addDrawings(["G1", PATH]))
    if ("message" in result) throw new Error(result.message)
    // The last in the file goes first, so an unnamed one's index id still names it when its turn comes.
    expect(result.plan.edits).toEqual([{ kind: "removeDrawing", id: PATH }, { kind: "removeDrawing", id: "G1" }])
    expect(result.plan.summary).toBe("remove 2 drawings")
    expect(result.drawings).toEqual(["G1", PATH])
    expect(result.question).toBeUndefined()
    expect(rebuilt(result.plan.edits).schematic.drawings.map((drawing) => drawing.id)).toEqual(["G3", "G2", "G4", "D[0:7]"])
  })

  test("two unnamed drawings of one kind both go, whatever order they were picked in", () => {
    const twoPaths = SOURCE.replace("<group", '<schematicpath points={[{ x: 0, y: 5 }, { x: 1, y: 5 }]} />\n    <group')
    const model = analyzeCircuit(twoPaths)
    const sheetOf = buildDesign({ [FILE]: twoPaths }, FILE).schematic.drawings
    const picked = Selection.none.addDrawings([PATH, "drawing:path:2"])
    const result = deletePlan(picked, () => null, undefined, undefined, drawingsRemoval(model, sheetOf, new Set()))
    if ("message" in result) throw new Error(result.message)
    const after = buildDesign({ [FILE]: applyEdits(twoPaths, result.plan.edits, new Set()) }, FILE)
    expect(after.schematic.drawings.filter((drawing) => drawing.kind === "path")).toEqual([])
  })

  test("with parts the drawings go in the same change; a locked drawing is named and stays", () => {
    const result = remove(Selection.none.only("R1").addDrawings(["G1", "G3"]), new Set(["G3"]))
    if ("message" in result) throw new Error(result.message)
    expect(result.plan.edits).toEqual([{ kind: "removeDrawing", id: "G1" }, { kind: "removePart", part: "R1" }])
    expect(result.plan.summary).toBe("remove R1 and G1")
    expect(result.plan.skipped).toEqual(["G3 is locked"])
    expect(result.drawings).toEqual(["G1"])
    expect(result.question).toBe("Remove R1 and its connections?")
  })
})
