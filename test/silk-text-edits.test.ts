import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { applyEdits, EditError } from "../src/core/edit.js"
import type { Edit } from "../src/core/types.js"

const none = new Set<string>()

const BOARD = `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0402" />
    <hole x={2} y={3} diameter={3.2} />
    <silkscreentext text="IO-8" x={0} y={8} />
    <trace from=".R1 > .pin1" to="net.GND" />
  </board>
)
`

function refusal(edits: Edit[], locked: ReadonlySet<string> = none): string {
  try {
    applyEdits(BOARD, edits, locked)
  } catch (error) {
    expect(error).toBeInstanceOf(EditError)
    return (error as Error).message
  }
  throw new Error("expected an EditError")
}

const texts = (source: string) => (analyzeCircuit(source).boardItems ?? []).filter((item) => item.tag === "silkscreentext")

describe("editing the board's silkscreen texts", () => {
  test("the scan lists each text by its id with its props", () => {
    expect(texts(BOARD).map((item) => [item.id, item.props["text"]?.literal, item.editable])).toEqual([["silkscreentext:1", "IO-8", true]])
  })

  test("addSilkText writes the element after the last text, so it takes the next id", () => {
    const out = applyEdits(BOARD, [{ kind: "addSilkText", text: "rev b", x: 4, y: -8, layer: "bottom", height: 1.2, rotation: 90, name: "Rev" }], none)
    expect(out).toContain(`    <silkscreentext text="IO-8" x={0} y={8} />\n    <silkscreentext name="Rev" text="rev b" x={4} y={-8} layer="bottom" height={1.2} rotation={90} />\n`)
    expect(texts(out).map((item) => item.id)).toEqual(["silkscreentext:1", "silkscreentext:2"])
  })

  test("setSilkText moves, rewords and flips a text; null removes an optional prop", () => {
    const out = applyEdits(BOARD, [{ kind: "setSilkText", id: "silkscreentext:1", props: { x: 3, text: "IO-8 v2", layer: "bottom", height: 2 } }], none)
    expect(out).toContain(`<silkscreentext text="IO-8 v2" x={3} y={8} layer="bottom" height={2} />`)
    const back = applyEdits(out, [{ kind: "setSilkText", id: "silkscreentext:1", props: { height: null } }], none)
    expect(back).toContain(`<silkscreentext text="IO-8 v2" x={3} y={8} layer="bottom" />`)
  })

  test("removeSilkText takes the element out", () => {
    const out = applyEdits(BOARD, [{ kind: "removeSilkText", id: "silkscreentext:1" }], none)
    expect(out).not.toContain("silkscreentext")
  })

  test("refuses empty words, too small a height, a character the lettering lacks, a bad side, a place off the board and a lock, in plain words", () => {
    const add = (fields: Partial<Extract<Edit, { kind: "addSilkText" }>>): Edit => ({ kind: "addSilkText", text: "OK", x: 0, y: 0, layer: "top", ...fields })
    expect(refusal([add({ text: "" })])).toBe("text must be some words, not empty")
    expect(refusal([add({ height: 0.3 })])).toBe("height must be at least 0.8 mm, the smallest text a board house prints legibly")
    expect(refusal([add({ text: "5 µA" })])).toMatch(/^the silkscreen lettering cannot draw "µ"; it draws A-Z a-z 0-9/)
    expect(refusal([add({ layer: "inner1" as "top" })])).toBe('layer must be "top" or "bottom"')
    expect(refusal([add({ x: 40 })])).toBe("the text's middle (40, 0) lies outside the board; put it on the board")
    expect(refusal([{ kind: "setSilkText", id: "silkscreentext:1", props: { text: null } }])).toBe("text cannot be removed; only height, rotation, name can")
    expect(refusal([{ kind: "setSilkText", id: "silkscreentext:1", props: { colour: "red" } }])).toMatch(/^A silkscreen text has no prop "colour"/)
    expect(refusal([{ kind: "removeSilkText", id: "silkscreentext:9" }])).toBe("No silkscreen text with id silkscreentext:9")
    expect(refusal([{ kind: "removeSilkText", id: "silkscreentext:1" }], new Set(["silkscreentext:1"]))).toBe("silkscreentext:1 is locked; ask the human to unlock it")
  })
})
