import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits } from "../src/core/edit.js"
import { buildDesign } from "../src/engine/design.js"
import { deletable } from "../studio/src/pcb/delete-plan.js"
import { Selection } from "../studio/src/selection.js"
import {
  boardTexts,
  boardWithTextMoves,
  sheetTexts,
  sheetWithTextMoves,
  textBlocker,
  textMoved,
  textNudge,
  textProperties,
  textMoveEdits,
  textResetEdits,
  textUnder,
  textView,
} from "../studio/src/pcb/part-text.js"

const FILE = "main.circuit.tsx"
const wrap = (r1: string) => `export default () => (
  <board width="30mm" height="18mm">
    <resistor name="R1" resistance="1k" footprint="0402" schX={0} schY={0} pcbX={2} pcbY={3}${r1} />
    <resistor name="R2" resistance="2k2" footprint="0402" schX={3} schY={0} pcbX={8} pcbY={3} />
  </board>
)`

const setup = (r1 = "") => {
  const source = wrap(r1)
  return { source, design: buildDesign({ [FILE]: source }, FILE), circuit: { model: analyzeCircuit(source) } }
}

const textOf = (texts: ReturnType<typeof sheetTexts>, id: string) => {
  const text = texts.find((t) => t.id === id)
  if (!text) throw new Error(`no text ${id}`)
  return text
}

describe("the texts a view shows", () => {
  test("the schematic has each part's name and value, the PCB each part's designator", () => {
    const { design } = setup()
    expect(sheetTexts(design.schematic).map((t) => t.id)).toEqual(["R1:schNameAt", "R1:schValueAt", "R2:schNameAt", "R2:schValueAt"])
    expect(boardTexts(design.pcb).map((t) => [t.id, t.text])).toEqual([["R1:pcbNameAt", "R1"], ["R2:pcbNameAt", "R2"]])
    expect(textView("R1:schValueAt")).toBe("schematic")
    expect(textView("R1:pcbNameAt")).toBe("pcb")
    expect(textView("R1")).toBeUndefined()
  })

  test("the text under a point", () => {
    const texts = sheetTexts(setup().design.schematic)
    const value = textOf(texts, "R2:schValueAt")
    expect(textUnder(texts, value.at)?.id).toBe("R2:schValueAt")
    expect(textUnder(texts, { x: 50, y: 50 })).toBeUndefined()
  })

  test("the designator sits above the courtyard until pcbNameAt moves it", () => {
    const plain = textOf(boardTexts(setup().design.pcb), "R1:pcbNameAt")
    expect(plain.at.x).toBeCloseTo(2, 6)
    expect(plain.at.y).toBeGreaterThan(3)
    const moved = textOf(boardTexts(setup(" pcbNameAt={{ x: -1, y: 0.5 }}").design.pcb), "R1:pcbNameAt")
    expect(moved.at).toEqual({ x: 1, y: 3.5 })
    expect(moved.offset).toEqual({ x: -1, y: 0.5 })
  })
})

describe("moving a text", () => {
  test("a drop writes one set_props edit with the offset from the part's origin", () => {
    const { design, source } = setup()
    const name = textOf(sheetTexts(design.schematic), "R1:schNameAt")
    const edits = textMoveEdits(name, { x: 0.5, y: 0.7 })
    expect(edits).toEqual([{ kind: "setProps", part: "R1", props: { schNameAt: { x: 0.5, y: 0.7 } } }])
    const after = applyEdits(source, edits, new Set())
    const moved = textOf(sheetTexts(buildDesign({ [FILE]: after }, FILE).schematic), "R1:schNameAt")
    expect(moved.at).toEqual({ x: 0.5, y: 0.7 })
  })

  test("a drop where it already is writes nothing", () => {
    const name = textOf(sheetTexts(setup(" schNameAt={{ x: 0.5, y: 0.7 }}").design.schematic), "R1:schNameAt")
    expect(textMoveEdits(name, { x: 0.5, y: 0.7 })).toEqual([])
  })

  test("a moved part keeps its texts' offsets", () => {
    const { design, source } = setup(" schNameAt={{ x: 0.5, y: 0.7 }}")
    const before = textOf(sheetTexts(design.schematic), "R1:schNameAt")
    const after = applyEdits(source, [{ kind: "setProps", part: "R1", props: { schX: 2, schY: -1 } }], new Set())
    const moved = textOf(sheetTexts(buildDesign({ [FILE]: after }, FILE).schematic), "R1:schNameAt")
    expect(moved.offset).toEqual(before.offset)
    expect(moved.at).toEqual({ x: 2.5, y: -0.3 })
  })

  test("Reset position removes the prop", () => {
    const { source, circuit } = setup(" schValueAt={{ x: 1, y: 1 }}")
    expect(textMoved(circuit, "R1:schValueAt")).toBe(true)
    expect(textMoved(circuit, "R1:schNameAt")).toBe(false)
    const edits = textResetEdits("R1:schValueAt")
    expect(edits).toEqual([{ kind: "setProps", part: "R1", props: { schValueAt: null } }])
    expect(applyEdits(source, edits, new Set())).toBe(wrap(""))
  })

  test("a locked part's texts and a prop written as an expression do not move", () => {
    const { circuit } = setup()
    expect(textBlocker(circuit, new Set(["R1"]), "R1:schNameAt")).toBe("R1 is locked")
    expect(textBlocker(circuit, new Set(), "R1:schNameAt")).toBeNull()
    const expression = { model: analyzeCircuit(wrap(" schNameAt={spot}")) }
    expect(textBlocker(expression, new Set(), "R1:schNameAt")).toBe("R1.schNameAt is an expression; change it in the code")
    expect(textBlocker(circuit, new Set(), "Q9:schNameAt")).toBe("This part has no editable source element")
  })
})

describe("drawing moves that wait for their build", () => {
  test("the sheet draws a moved name at its new place, turned symbols too", () => {
    const { design } = setup(" schRotation={90}")
    const moved = sheetWithTextMoves(design.schematic, [{ id: "R1:schNameAt", at: { x: -1, y: 2 } }])
    expect(textOf(sheetTexts(moved), "R1:schNameAt").at).toEqual({ x: -1, y: 2 })
    expect(textOf(sheetTexts(moved), "R1:schValueAt")).toEqual(textOf(sheetTexts(design.schematic), "R1:schValueAt"))
    expect(sheetWithTextMoves(design.schematic, [])).toBe(design.schematic)
  })

  test("the board draws a moved designator at its new place", () => {
    const { design } = setup()
    const moved = boardWithTextMoves(design.pcb, [{ id: "R2:pcbNameAt", at: { x: 9, y: 5 } }])
    expect(moved.parts.find((p) => p.component === "R2")?.nameAt).toEqual({ x: 9, y: 5 })
    expect(moved.parts.find((p) => p.component === "R1")?.nameAt).toBeUndefined()
  })
})

describe("Properties of a name, value or designator", () => {
  test("shows the part, the text and the offset, and whether Reset position has a prop to remove", () => {
    const moved = setup(" pcbNameAt={{ x: -1, y: 0.5 }}")
    const shown = textProperties(moved.design, moved.circuit, "R1:pcbNameAt", new Set())
    expect(shown?.title).toBe("Designator")
    expect(shown?.rows).toEqual([
      { label: "Part", value: "R1" },
      { label: "Text", value: "R1" },
      { label: "Offset X", value: "-1 mm" },
      { label: "Offset Y", value: "0.5 mm" },
      { label: "Position", value: "Moved (pcbNameAt)" },
    ])
    expect(shown?.moved).toBe(true)
    const plain = setup()
    const value = textProperties(plain.design, plain.circuit, "R2:schValueAt", new Set(["R2"]))
    expect(value).toMatchObject({ title: "Value", moved: false, blocker: "R2 is locked" })
    expect(value?.rows.at(-1)).toEqual({ label: "Position", value: "Where the layout puts it" })
    expect(textProperties(plain.design, plain.circuit, "Q9:schNameAt", new Set())).toBeUndefined()
  })
})

describe("the keys", () => {
  test("an arrow moves a name or value selected alone by grid steps, ten with Shift; with anything else the parts move", () => {
    const one = Selection.none.onlyText("R1:schNameAt")
    expect(textNudge(one, { action: "nudgeLeft", preventDefault: true, steps: 1 }, { step: 0.1 })).toEqual({ id: "R1:schNameAt", by: { x: -0.1, y: 0 } })
    expect(textNudge(one, { action: "nudgeUp", preventDefault: true, steps: 10 }, { step: 0.5 })).toEqual({ id: "R1:schNameAt", by: { x: 0, y: 5 } })
    expect(textNudge(one.add(["R1"]), { action: "nudgeUp", preventDefault: true, steps: 1 }, { step: 0.5 })).toBeUndefined()
  })

  test("Delete leaves names and values alone: with only those selected it does nothing", () => {
    expect(deletable(Selection.none.onlyText("R1:schNameAt"))).toBeUndefined()
    expect(deletable(Selection.none.onlyText("R1:schNameAt").add(["R2"]))?.names).toEqual(["R2"])
    expect(deletable(Selection.none.onlyText("R1:schNameAt").add(["R2"]))?.texts).toEqual([])
    expect(deletable(Selection.none)).toBe(Selection.none)
  })
})
