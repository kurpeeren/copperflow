import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { fabricationSet } from "../../src/engine/fab/export.js"

const MAIN = "main.circuit.tsx"
const SHEET = "Mount.sheet.tsx"
const CREATED = new Date(Date.UTC(2026, 10, 11, 12, 0, 0))

/** A 20 × 12 board (x −10…10, y −6…6) with one resistor and the given elements. */
const board = (extra: string, props = `width="20mm" height="12mm"`) => `export default () => (<board ${props}>
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />
    ${extra}
  </board>)`

const offBoard = (files: Record<string, string>) =>
  buildDesign(files, MAIN)
    .violations.filter((v) => v.code === "hole-off-board")
    .map((v) => [v.id, v.severity, v.message])

describe("a hole not wholly inside the board", () => {
  test("a hole wholly off the board and one across its edge are hole-off-board errors; one inside, keeping the edge clearance, is not", () => {
    const found = offBoard({ [MAIN]: board(`<hole x={30} y={0} diameter={3} /><hole x={9.5} y={0} diameter={2} /><hole x={-7} y={3} diameter={2} />`) })
    expect(found).toEqual([
      ["hole-off-board:hole:1", "error", "hole:1 at (30, 0), 3 mm is not inside the board: a hole keeps 0.2 mm from the board edge"],
      ["hole-off-board:hole:2", "error", "hole:2 at (9.5, 0), 2 mm is not inside the board: a hole keeps 0.2 mm from the board edge"],
    ])
  })

  test("the check is on the built geometry: a hole in a group, a sub-sheet or a board outline is covered", () => {
    const outline = `outline={[{x:0,y:0},{x:20,y:0},{x:0,y:20}]}`
    expect(offBoard({ [MAIN]: board(`<hole x={15} y={15} diameter={2} /><hole x={4} y={4} diameter={2} />`, outline) }).map(([id]) => id)).toEqual(["hole-off-board:hole:1"])
    expect(offBoard({ [MAIN]: board(`<group pcbX={9}><hole x={1} y={0} diameter={2} /></group>`) }).map(([id]) => id)).toEqual(["hole-off-board:hole:1"])
    const sheet = `export default function Mount() {\n  return (\n    <sheet>\n      <hole x={0} y={0} diameter={3} />\n    </sheet>\n  )\n}\n`
    const main = `import Mount from "./Mount.sheet"\n${board(`<Mount name="M1" pcbX={10} pcbY={0} />`)}`
    expect(offBoard({ [MAIN]: main, [SHEET]: sheet }).map(([id]) => id)).toEqual(["hole-off-board:M1/hole:1"])
  })

  test("the export refuses a board with a hole off it", () => {
    const set = fabricationSet(buildDesign({ [MAIN]: board(`<hole x={30} y={0} diameter={3} />`) }, MAIN), [], CREATED)
    expect(set.ok).toBe(false)
    expect(set.ok ? [] : set.errors.join("\n")).toMatch(/hole:1 at \(30, 0\), 3 mm is not inside the board/)
  })
})
