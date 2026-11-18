// The Studio's board texts as plain logic: the press that finds one, the drag's move, Properties' rows and edits, and
// Delete.
import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { buildDesign } from "../src/engine/design.js"
import type { SilkText } from "../src/engine/model.js"
import { DEFAULT_LAYERS } from "../studio/src/pcb/layers.js"
import { boardFieldEdit, boardLockButton, boardProperties } from "../studio/src/pcb/pour-props.js"
import { boardRemoval } from "../studio/src/pcb/pour-tool.js"
import { silkTextAt } from "../studio/src/pcb/silk-text-draw.js"
import { dragOffset, silkTextMove } from "../studio/src/pcb/silk-text-edit.js"

const MAIN = "main.circuit.tsx"
const SOURCE = `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-10} pcbY={-6} />
    <silkscreentext text="IO-8" x={0} y={8} height={2} />
    <silkscreentext text="rev" x={5} y={-5} layer="bottom" />
  </board>
)
`
const design = buildDesign({ [MAIN]: SOURCE }, MAIN)
const texts = design.pcb.silkTexts as SilkText[]

describe("picking a board text", () => {
  test("a point on the text's ink takes it, a point beside it does not, a hidden silk layer hides it", () => {
    expect(silkTextAt(texts, { x: 0, y: 8 }, DEFAULT_LAYERS, 0.1)?.id).toBe("silkscreentext:1")
    expect(silkTextAt(texts, { x: 0, y: 3 }, DEFAULT_LAYERS, 0.1)).toBeUndefined()
    expect(silkTextAt(texts, { x: 0, y: 8 }, { ...DEFAULT_LAYERS, topSilk: false }, 0.1)).toBeUndefined()
  })
})

describe("dragging a board text", () => {
  const text = texts[0] as SilkText
  const snapHalf = (p: { x: number; y: number }) => ({ x: Math.round(p.x * 2) / 2, y: Math.round(p.y * 2) / 2 })

  test("writes the moved middle as one edit, on the grid while Snap is on", () => {
    const drag = { id: text.id, start: { x: 0.2, y: 8 }, to: { x: 3.4, y: 6.9 }, moved: true }
    expect(silkTextMove(text, drag)).toEqual({ edit: { kind: "setSilkText", id: "silkscreentext:1", props: { x: 3.2, y: 6.9 } }, summary: "move silkscreentext:1 to (3.2, 6.9)" })
    expect(silkTextMove(text, drag, snapHalf)?.edit).toEqual({ kind: "setSilkText", id: "silkscreentext:1", props: { x: 3, y: 7 } })
    expect(dragOffset(text, drag, snapHalf)).toEqual({ x: 3, y: -1 })
  })

  test("a press that never passed the threshold writes nothing", () => {
    expect(silkTextMove(text, { id: text.id, start: { x: 0, y: 8 }, to: { x: 0.01, y: 8 }, moved: false })).toBeUndefined()
  })
})

describe("Properties and Delete for a board text", () => {
  test("shows its words, place, height, turn and side, and each change is one setSilkText", () => {
    const shown = boardProperties(design, "silkscreentext:2")
    expect(shown?.title).toBe("Silkscreen text")
    expect(shown?.rows.map((row) => [row.label, row.value])).toEqual([
      ["Text", "rev"],
      ["X (mm)", "5"],
      ["Y (mm)", "-5"],
      ["Height (mm)", "1.5"],
      ["Rotation (°)", "0"],
      ["Side", "bottom"],
    ])
    expect(boardFieldEdit(design, "silkscreentext:2", "text", "rev B")).toEqual({ edit: { kind: "setSilkText", id: "silkscreentext:2", props: { text: "rev B" } }, summary: "set silkscreentext:2 text=rev B" })
    expect(boardFieldEdit(design, "silkscreentext:2", "layer", "top")).toMatchObject({ edit: { kind: "setSilkText", id: "silkscreentext:2", props: { layer: "top" } } })
    expect(boardFieldEdit(design, "silkscreentext:2", "rotation", "90")).toMatchObject({ edit: { kind: "setSilkText", id: "silkscreentext:2", props: { rotation: 90 } } })
    expect(boardFieldEdit(design, "silkscreentext:2", "height", "big")).toEqual({ message: "height must be a number" })
    expect(boardLockButton("silkscreentext:2", { locked: new Set(), violated: new Set() }).title).toBe("Lock this silkscreen text, so the agent cannot change or remove it")
  })

  test("Delete removes the selected texts, the last first, and names them", () => {
    const removal = boardRemoval(analyzeCircuit(SOURCE), new Set())(["silkscreentext:1", "silkscreentext:2"])
    expect(removal.edits).toEqual([
      { kind: "removeSilkText", id: "silkscreentext:2" },
      { kind: "removeSilkText", id: "silkscreentext:1" },
    ])
    expect(removal.names).toEqual(["silkscreen text 1", "silkscreen text 2"])
  })
})
