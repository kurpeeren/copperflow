import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { drawingAfterBuild, renamedAfterBuild, stableDrawings } from "../studio/src/pcb/drawing-selection.js"
import { shownSelection } from "../studio/src/pcb/wire-selection.js"
import { Selection } from "../studio/src/selection.js"

const FILE = "main.circuit.tsx"
const A = `<schematicpath points={[{ x: 0, y: 0 }, { x: 1, y: 0 }]} />`
const B = `<schematicpath points={[{ x: 0, y: 2 }, { x: 1, y: 2 }]} />`
const G1 = `<schematicrect name="G1" x={1} y={2} width={3} height={1} />`
const sheet = (...tags: string[]) =>
  buildDesign({ [FILE]: `export default () => (\n  <board width="30mm" height="18mm">\n    ${tags.join("\n    ")}\n  </board>\n)` }, FILE).schematic.drawings

const before = sheet(A, B, G1)
const FIRST = "drawing:path:1"
const SECOND = "drawing:path:2"

describe("selected drawings after a build", () => {
  test("an unnamed drawing whose id the next one takes, after the first is deleted, leaves the selection", () => {
    const after = sheet(B, G1)
    expect(stableDrawings(before, after)).toEqual(["G1"])
    expect(drawingAfterBuild(Selection.none.addDrawings([FIRST, "G1"]), before, after).drawings).toEqual(["G1"])
  })

  test("a drawing that only moved, or whose style changed, stays selected", () => {
    const moved = sheet(A, B.replace("y: 2 }, { x: 1, y: 2", "y: 3 }, { x: 1, y: 3"), G1.replace("x={1}", "x={2}"))
    expect(stableDrawings(before, moved)).toEqual([FIRST, SECOND, "G1"])
    const restyled = sheet(A.replace("/>", 'lineStyle="dashed" />'), B, G1)
    expect(stableDrawings(before, restyled)).toEqual([FIRST, SECOND, "G1"])
  })

  test("with a drawing of the kind added or removed, an unnamed one stays only where it is unchanged; a new id has nothing to compare", () => {
    const added = sheet(B, A, B, G1)
    expect(stableDrawings(before, added)).toEqual(["drawing:path:3", "G1"])
    expect(stableDrawings(before, sheet(A, G1))).toEqual([FIRST, "G1"])
  })

  test("a named drawing stays while its id is in the sheet; with no earlier sheet every drawing stays", () => {
    expect(stableDrawings(before, sheet(G1))).toEqual(["G1"])
    expect(stableDrawings(undefined, before)).toEqual([FIRST, SECOND, "G1"])
  })

  test("the first piece of a bus drawn in pieces leaves the selection when the other piece takes its name", () => {
    const BUS1 = `<bus name="D[0:3]" points={[{ x: 0, y: 5 }, { x: 2, y: 5 }]} />`
    const BUS2 = `<bus name="D[0:3]" points={[{ x: 0, y: 7 }, { x: 2, y: 7 }]} />`
    const two = sheet(BUS1, BUS2)
    expect(two.map((d) => d.id)).toEqual(["D[0:3]", "D[0:3]~2"])
    expect(stableDrawings(two, sheet(BUS2))).toEqual([])
    expect(stableDrawings(two, sheet(BUS1, BUS2.replace("y: 7 }, { x: 2, y: 7", "y: 8 }, { x: 2, y: 8")))).toEqual(["D[0:3]", "D[0:3]~2"])
  })

  test("the selection shown leaves out a drawing whose id now names another one", () => {
    const after = sheet(B, G1)
    const shown = shownSelection(Selection.none.addDrawings([FIRST, "G1"]), { view: "schematic", drawings: stableDrawings(before, after) })
    expect(shown.drawings).toEqual(["G1"])
  })
})

describe("a renamed drawing after its build", () => {
  const P1 = `<bus name="D[0:7]" points={[{ x: 0, y: 4 }, { x: 2, y: 4 }]} />`
  const P2 = `<bus name="D[0:7]" points={[{ x: 0, y: 6 }, { x: 2, y: 6 }]} />`
  const pieces = sheet(P1, P2, G1)
  const renamed = sheet(P1.replace("D[0:7]", "A[3:0]"), P2, G1)

  test("the renamed piece stays selected under its new id; the piece that took its old id is not selected", () => {
    const selection = Selection.none.addDrawings(["D[0:7]", "G1"])
    const { selection: next, waiting } = renamedAfterBuild(selection, [{ from: "D[0:7]", to: "A[3:0]" }], renamed)
    expect(waiting).toEqual([])
    expect(drawingAfterBuild(next, pieces, renamed).drawings.slice().sort()).toEqual(["A[3:0]", "G1"])
  })

  test("a rename whose build has not come keeps waiting; one not selected changes nothing", () => {
    const selection = Selection.none.addDrawings(["D[0:7]"])
    expect(renamedAfterBuild(selection, [{ from: "D[0:7]", to: "A[3:0]" }], pieces)).toEqual({ selection, waiting: [{ from: "D[0:7]", to: "A[3:0]" }] })
    const other = Selection.none.addDrawings(["G1"])
    expect(renamedAfterBuild(other, [{ from: "D[0:7]", to: "A[3:0]" }], renamed)).toEqual({ selection: other, waiting: [] })
  })
})
