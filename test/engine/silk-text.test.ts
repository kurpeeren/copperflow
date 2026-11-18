import { describe, expect, test } from "vitest"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import { silkTextBox, silkTextStrokes } from "../../src/engine/fab/silk-text-strokes.js"
import type { Circuit, SilkText } from "../../src/engine/model.js"

const MAIN = "main.circuit.tsx"
const noPads = { padCount: () => undefined }

function build(body: string): Circuit {
  const files = { [MAIN]: `export default () => (\n  <board width="30mm" height="20mm">\n    <resistor name="R1" />\n${body}\n  </board>\n)\n` }
  return elaborate(evaluateCircuit(files, MAIN), MAIN, noPads)
}

const messages = (circuit: Circuit) => circuit.diagnostics.map((d) => d.message)

describe("<silkscreentext> in the circuit file", () => {
  test("is read with its defaults: top side, 1.5 mm, no turn", () => {
    const circuit = build(`<silkscreentext text="IO-8 v1" x={2} y={-3} />`)
    expect(circuit.diagnostics).toEqual([])
    expect(circuit.board?.silkTexts).toEqual([
      { id: "silkscreentext:1", text: "IO-8 v1", x: 2, y: -3, layer: "top", height: 1.5, rotation: 0, source: expect.anything() },
    ])
  })

  test("takes a side, a height, a turn and a name; a group moves and turns it", () => {
    const circuit = build(`<silkscreentext name="Rev" text="rev b" x={1} y={0} layer="bottom" height="2mm" rotation={90} />
<group pcbX={5} pcbY={1}><silkscreentext text="+5V" x={0} y={0} /></group>`)
    expect(circuit.diagnostics).toEqual([])
    expect(circuit.board?.silkTexts?.map(({ source: _, ...rest }) => rest)).toEqual([
      { id: "silkscreentext:1", text: "rev b", x: 1, y: 0, layer: "bottom", height: 2, rotation: 90, name: "Rev" },
      { id: "silkscreentext:2", text: "+5V", x: 5, y: 1, layer: "top", height: 1.5, rotation: 0 },
    ])
  })

  test("refuses empty text, too small a height, a character the lettering lacks, a bad side and no position, each with its reason", () => {
    const circuit = build(`<silkscreentext text="  " x={0} y={0} />
<silkscreentext text="tiny" x={0} y={0} height={0.5} />
<silkscreentext text="5 µA" x={0} y={0} />
<silkscreentext text="side" x={0} y={0} layer="inner1" />
<silkscreentext text="where" />
<silkscreentext text="kept" x={0} y={0} />`)
    expect(messages(circuit)).toEqual([
      "silkscreentext silkscreentext:1: text must be some words, not empty; it is ignored",
      "silkscreentext silkscreentext:2: height must be at least 0.8 mm, the smallest text a board house prints legibly; it is ignored",
      'silkscreentext silkscreentext:3: the silkscreen lettering cannot draw "µ"; it draws A-Z a-z 0-9, space and - _ + . / ~ ( ) # : % = , !; it is ignored',
      'silkscreentext silkscreentext:4: layer must be "top" or "bottom"; it is ignored',
      "silkscreentext silkscreentext:5: needs x and y; it is ignored",
    ])
    // A dropped text keeps its number, so the ones after it keep their ids.
    expect(circuit.board?.silkTexts?.map((t) => t.id)).toEqual(["silkscreentext:6"])
  })
})

const text = (fields: Partial<SilkText> = {}): SilkText => ({ id: "silkscreentext:1", text: "AB", x: 10, y: 5, layer: "top", height: 2, rotation: 0, source: { file: MAIN, line: 1, column: 1, offset: 0 }, ...fields })
const extent = (lines: { x: number; y: number }[][]) => {
  const points = lines.flat()
  return { minX: Math.min(...points.map((p) => p.x)), maxX: Math.max(...points.map((p) => p.x)), minY: Math.min(...points.map((p) => p.y)), maxY: Math.max(...points.map((p) => p.y)) }
}

describe("a board text's strokes", () => {
  test("a known string at a known height lies in the expected box, centred on its place", () => {
    // Two capitals 2 mm tall: 4 + 6 + 4 grid units wide at 1/3 mm each, 10/3 mm.
    const box = extent(silkTextStrokes(text()))
    expect(box.minX).toBeCloseTo(10 - 5 / 3, 9)
    expect(box.maxX).toBeCloseTo(10 + 5 / 3, 9)
    expect(box.minY).toBeCloseTo(4, 9)
    expect(box.maxY).toBeCloseTo(6, 9)
    expect(silkTextBox(text()).maxY).toBeCloseTo(6.1, 9)
  })

  test("on the bottom side the text is mirrored left to right about its place", () => {
    const top = silkTextStrokes(text({ text: "R" }))
    const bottom = silkTextStrokes(text({ text: "R", layer: "bottom" }))
    expect(bottom.map((line) => line.map((p) => ({ x: Math.round((20 - p.x) * 1e9) / 1e9, y: p.y })))).toEqual(
      top.map((line) => line.map((p) => ({ x: Math.round(p.x * 1e9) / 1e9, y: p.y }))),
    )
  })

  test("a quarter turn makes it read from the bottom up", () => {
    const box = extent(silkTextStrokes(text({ rotation: 90 })))
    expect(box.minX).toBeCloseTo(9, 9)
    expect(box.maxX).toBeCloseTo(11, 9)
    expect(box.maxY - box.minY).toBeCloseTo(10 / 3, 9)
    // The first letter is lower down than the second.
    const strokes = silkTextStrokes(text({ rotation: 90 }))
    expect(Math.max(...(strokes[0] ?? []).map((p) => p.y))).toBeLessThan(Math.min(...(strokes.at(-1) ?? []).map((p) => p.y)))
  })
})
