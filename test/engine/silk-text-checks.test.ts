import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"

const MAIN = "main.circuit.tsx"
/** A 30 × 20 board (x −15…15, y −10…10) with a resistor at (−10, −6), a hole at (8, 6) and the given texts. */
const design = (texts: string) =>
  buildDesign(
    {
      [MAIN]: `export default () => (
  <board width="30mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={-10} pcbY={-6} />
    <hole x={8} y={6} diameter={2} />
    ${texts}
  </board>
)`,
    },
    MAIN,
  )
const found = (texts: string, code: string) =>
  design(texts)
    .violations.filter((v) => v.code === code && v.items.some((item) => item.startsWith("silkscreentext")))
    .map((v) => [v.id, v.message])

describe("a board text's checks", () => {
  test("a text clear of pads, holes and the edge has no finding", () => {
    expect(found(`<silkscreentext text="clear" x={0} y={0} />`, "silk-on-pad")).toEqual([])
    expect(found(`<silkscreentext text="clear" x={0} y={0} />`, "silk-off-board")).toEqual([])
  })

  test("a text over a pad or a hole is silk-on-pad, as a part's silkscreen over a pad is", () => {
    expect(found(`<silkscreentext text="OVER" x={-10} y={-6} />`, "silk-on-pad")).toEqual([
      ["silk-on-pad:R1#1,silkscreentext:1", 'Silkscreen text silkscreentext:1 "OVER" is on R1#1; the minimum is 0.150 mm: move the text'],
      ["silk-on-pad:R1#2,silkscreentext:1", 'Silkscreen text silkscreentext:1 "OVER" is on R1#2; the minimum is 0.150 mm: move the text'],
    ])
    expect(found(`<silkscreentext text="HOLE" x={8} y={6} layer="bottom" />`, "silk-on-pad").map(([id]) => id)).toEqual(["silk-on-pad:hole:1,silkscreentext:1"])
  })

  test("a top text does not meet a pad only on the bottom side", () => {
    expect(found(`<silkscreentext text="OVER" x={-10} y={-6} layer="bottom" />`, "silk-on-pad")).toEqual([])
  })

  test("a text running past the outline is silk-off-board", () => {
    expect(found(`<silkscreentext text="FAR TOO LONG" x={13} y={0} />`, "silk-off-board")).toEqual([
      ["silk-off-board:silkscreentext:1", 'Silkscreen text silkscreentext:1 "FAR TOO LONG" runs off the board; the board house clips it at the edge: move it inside the outline or shorten it'],
    ])
  })
})
