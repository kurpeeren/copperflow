import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { boxOfPoints } from "../../src/engine/pcb-place/geometry.js"
import { fitBoard } from "../../src/engine/pcb-place/index.js"
import { CAN_FOLDER, CAN_MAIN, filesIn } from "../helpers/place-fixtures.js"

describe("fitBoard", () => {
  const design = buildDesign(filesIn(CAN_FOLDER), CAN_MAIN)
  const parts = boxOfPoints(design.pcb.parts.flatMap((p) => p.courtyard))

  test("fits the CAN module's rectangle to every courtyard plus the 2 mm margin, rounded out to 0.1 mm", () => {
    const fit = fitBoard(design)
    if ("error" in fit) throw new Error(fit.error)
    const box = boxOfPoints(fit.outline)
    expect(fit.outline).toHaveLength(4)
    expect(box.minX).toBeLessThanOrEqual(parts.minX - 2 + 1e-6)
    expect(box.minX).toBeGreaterThan(parts.minX - 2.1)
    expect(box.minY).toBeLessThanOrEqual(parts.minY - 2 + 1e-6)
    expect(box.minY).toBeGreaterThan(parts.minY - 2.1)
    expect(box.maxX).toBeGreaterThanOrEqual(parts.maxX + 2 - 1e-6)
    expect(box.maxX).toBeLessThan(parts.maxX + 2.1)
    expect(box.maxY).toBeGreaterThanOrEqual(parts.maxY + 2 - 1e-6)
    expect(box.maxY).toBeLessThan(parts.maxY + 2.1)
    expect(fit.width).toBeCloseTo(box.maxX - box.minX, 6)
    expect(fit.height).toBeCloseTo(box.maxY - box.minY, 6)
    // The courtyards span 38.2 mm across (J1 to J2); 2 mm on each side makes 42.2 mm.
    expect(fit.width).toBeCloseTo(42.2, 6)
    expect(fit.centre.x).toBeCloseTo((box.minX + box.maxX) / 2, 6)
    expect(fit.centre.y).toBeCloseTo((box.minY + box.maxY) / 2, 6)
  })

  test("a smaller margin gives a smaller board, never closer than the edge clearance", () => {
    const tight = fitBoard(design, 0)
    if ("error" in tight) throw new Error(tight.error)
    const box = boxOfPoints(tight.outline)
    expect(box.minX).toBeLessThanOrEqual(parts.minX - design.rules.fabrication.boardEdgeClearance + 1e-6)
    const roomy = fitBoard(design)
    if ("error" in roomy) throw new Error(roomy.error)
    expect(tight.width).toBeLessThan(roomy.width)
  })

  test("keeps holes inside", () => {
    const files = { "m.circuit.tsx": `export default () => (<board width="40mm" height="40mm"><resistor name="R1" footprint="0603" pcbX={0} pcbY={0} /><hole x={10} y={0} diameter={3} /></board>)` }
    const fit = fitBoard(buildDesign(files, "m.circuit.tsx"), 1)
    if ("error" in fit) throw new Error(fit.error)
    expect(boxOfPoints(fit.outline).maxX).toBeCloseTo(12.5, 6)
  })

  test("refuses an outline that is not a rectangle, and a negative margin", () => {
    const outline = "outline={[{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 15 }]}"
    const files = { "m.circuit.tsx": `export default () => (<board ${outline}><resistor name="R1" footprint="0603" pcbX={10} pcbY={4} /></board>)` }
    expect(fitBoard(buildDesign(files, "m.circuit.tsx"))).toEqual({ error: "fitBoard only reshapes a rectangular board; this outline is not one" })
    expect(fitBoard(design, -1)).toEqual({ error: "the margin must be 0 or more, got -1" })
  })
})
