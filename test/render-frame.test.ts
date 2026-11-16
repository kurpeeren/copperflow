import { expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { frameFor } from "../studio/src/render/render-frame.js"

const MAIN = "main.circuit.tsx"
const board = (body: string) => ({ [MAIN]: `export default () => (\n  <board width="20mm" height="10mm">\n${body}\n  </board>\n)\n` })

test("the whole-board picture is the board outline when every part is on it", () => {
  const design = buildDesign(board(`<resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />`), MAIN)
  const frame = frameFor(design, { view: "pcb" })
  expect(frame.what).toBe("PCB, whole board 20 x 10 mm")
  expect(frame.box.maxX).toBeLessThan(12)
})

test("a part outside the board is still in the picture, and the line says so", () => {
  const design = buildDesign(
    board(`<resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />\n<resistor name="R2" resistance="1k" footprint="0603" pcbX={40} pcbY={25} />`),
    MAIN,
  )
  const frame = frameFor(design, { view: "pcb" })
  expect(frame.what).toBe("PCB, whole board 20 x 10 mm, and 1 part outside it")
  // R2 at (40, 25) lies inside the box drawn.
  expect(frame.box.maxX).toBeGreaterThan(40)
  expect(frame.box.minX).toBeLessThan(-10)
  expect(Math.max(Math.abs(frame.box.minY), Math.abs(frame.box.maxY))).toBeGreaterThan(25)
})
