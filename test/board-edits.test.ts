import { describe, expect, test } from "vitest"
import { applyEdits } from "../src/core/edit.js"
import { buildDesign } from "../src/engine/design.js"

const MAIN = "main.circuit.tsx"
const circuit = (board: string) => `export default () => (\n  <board ${board}>\n    <resistor name="R1" resistance="1k" footprint="0603" pcbX={1} pcbY={2} />\n  </board>\n)\n`
const outlineOf = (source: string) => buildDesign({ [MAIN]: source }, MAIN).pcb.board?.outline

describe("setBoard", () => {
  test("writes width, height and the centre of a board drawn as a rectangle", () => {
    const after = applyEdits(circuit('width="30mm" height="20mm"'), [{ kind: "setBoard", width: 12.4, height: 8, x: 1.2, y: -3 }], new Set())
    expect(after).toContain("<board width={12.4} height={8} pcbX={1.2} pcbY={-3}>")
    expect(outlineOf(after)).toEqual([
      { x: -5, y: -7 },
      { x: 7.4, y: -7 },
      { x: 7.4, y: 1 },
      { x: -5, y: 1 },
    ])
  })

  test("leaves the centre out when it is the origin and was not written", () => {
    const after = applyEdits(circuit('width="30mm" height="20mm"'), [{ kind: "setBoard", width: 10, height: 6, x: 0, y: 0 }], new Set())
    expect(after).toContain("<board width={10} height={6}>")
  })

  test("writes the corners of a board drawn as an outline", () => {
    const after = applyEdits(circuit("outline={[{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 20 }, { x: 0, y: 20 }]}"), [{ kind: "setBoard", width: 10, height: 6, x: 5, y: 3 }], new Set())
    expect(outlineOf(after)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 6 },
      { x: 0, y: 6 },
    ])
  })

  test("refuses a board size written as an expression, a file without a board and a size that is not positive", () => {
    expect(() => applyEdits(circuit("width={W} height={20}"), [{ kind: "setBoard", width: 10, height: 6, x: 0, y: 0 }], new Set())).toThrow(/board\.width is an expression/)
    expect(() => applyEdits('export default () => (<sheet><resistor name="R1" /></sheet>)', [{ kind: "setBoard", width: 10, height: 6, x: 0, y: 0 }], new Set())).toThrow(/no <board>/)
    expect(() => applyEdits(circuit('width="30mm" height="20mm"'), [{ kind: "setBoard", width: 0, height: 6, x: 0, y: 0 }], new Set())).toThrow(/width must be/)
  })
})
