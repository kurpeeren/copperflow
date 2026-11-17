import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { boardVolume, partVolume, solidModel } from "../../src/engine/solid/model.js"
import { stepText } from "../../src/engine/solid/step.js"
import { productNames, readStep, solids } from "../helpers/step-read.js"

const MAIN = "main.circuit.tsx"
const BODY = `
  <hole x={-7} y={3} diameter={3} />
  <resistor name="R1" resistance="1k" footprint="0603" pcbX={2} pcbY={1} />
  <resistor name="R2" resistance="1k" footprint="0805" pcbX={-2} pcbY={-2} pcbRotation={45} />
  <capacitor name="C1" capacitance="100nF" footprint="0402" pcbX={5} pcbY={-2} layer="bottom" pcbRotation={90} />
  <pinheader name="J1" pinCount={3} footprint="pinrow3" pcbX={0} pcbY={-3.5} />`
const design = buildDesign({ [MAIN]: `export default () => (<board width="20mm" height="10mm">${BODY}</board>)` }, MAIN)
const model = solidModel(design)
const text = stepText(model, "main")

describe("the STEP file", () => {
  test("is an AP214 exchange file in mm whose references all resolve and whose entities have their arguments", () => {
    const file = readStep(text)
    expect(file.header).toContain("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));")
    expect(file.header).toContain("'main.step','2000-01-01T00:00:00'")
    expect(text).toContain("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))")
  })

  test("has a product per solid, named, in one assembly named after the design", () => {
    const file = readStep(text)
    expect(productNames(file)).toEqual(["main", "board", "R1", "R2", "C1", "J1"])
    const uses = [...file.entities.values()].filter((e) => e.name === "NEXT_ASSEMBLY_USAGE_OCCURRENCE")
    expect(uses).toHaveLength(5)
  })

  test("each solid is one closed shell: every edge used by two faces, once each way", () => {
    const found = solids(readStep(text))
    expect(found.map((s) => s.name)).toEqual(["board", "R1", "R2", "C1", "J1"])
    for (const solid of found) expect(solid.closed, solid.name).toBe(true)
    // The board: top, bottom, four sides, and two half cylinders per round hole (one mounting hole, three drills).
    expect(found[0]?.faces).toBe(6 + 2 * 4)
    for (const solid of found.slice(1)) expect(solid.faces, solid.name).toBe(6)
  })

  test("the volumes from the faces written equal the model's", () => {
    const found = solids(readStep(text))
    expect(found[0]?.volume).toBeCloseTo(boardVolume(model.board!), 6)
    model.parts.forEach((part, i) => expect(found[i + 1]?.volume, part.name).toBeCloseTo(partVolume(part), 6))
  })

  test("a second run writes the same bytes", () => {
    expect(stepText(solidModel(buildDesign({ [MAIN]: `export default () => (<board width="20mm" height="10mm">${BODY}</board>)` }, MAIN)), "main")).toBe(text)
  })

  test("is plain text with Unix line endings and every real written with a decimal point", () => {
    expect(text).not.toContain("\r")
    expect(text).not.toMatch(/[^\x0a\x20-\x7e]/)
    const geometry = text.split("\n").filter((line) => /=(CARTESIAN_POINT|DIRECTION|VECTOR|CIRCLE|CYLINDRICAL_SURFACE)\(/.test(line))
    expect(geometry.length).toBeGreaterThan(0)
    for (const line of geometry) expect(line).not.toMatch(/[(,]-?\d+[,)]/)
  })

  test("a design without a board writes the parts alone", () => {
    const bare = solidModel(buildDesign({ [MAIN]: `export default () => (<board><resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} /></board>)` }, MAIN))
    expect(productNames(readStep(stepText(bare, "main")))).toEqual(["main", "R1"])
  })
})
