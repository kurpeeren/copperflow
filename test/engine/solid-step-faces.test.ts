// The STEP file with its parts written as the faces the 3D view draws them with (step-faces.ts), from the Studio's
// own shapes (studio/src/render/step-faces.ts), and with faces made by hand for the edge cases.
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { boardVolume, solidModel } from "../../src/engine/solid/model.js"
import { stepText } from "../../src/engine/solid/step.js"
import type { PartFaces, StepFace } from "../../src/engine/solid/step-faces.js"
import { stepPartFaces } from "../../studio/src/render/step-faces.js"
import { productNames, readStep, solids, surfaces } from "../helpers/step-read.js"

const MAIN = "main.circuit.tsx"
const BODY = `
  <hole x={-7} y={3} diameter={3} />
  <resistor name="R1" resistance="1k" footprint="0603" pcbX={2} pcbY={1} />
  <resistor name="R2" resistance="1k" footprint="0805" pcbX={-2} pcbY={-2} pcbRotation={45} />
  <capacitor name="C1" capacitance="100nF" footprint="0402" pcbX={5} pcbY={-2} layer="bottom" pcbRotation={90} />
  <pinheader name="J1" pinCount={3} footprint="pinrow3" pcbX={0} pcbY={-3.5} />`
const source = `export default () => (<board width="20mm" height="10mm">${BODY}</board>)`
const design = buildDesign({ [MAIN]: source }, MAIN)
const model = solidModel(design)
const faces = stepPartFaces(design, model)
const text = stepText(model, "main", faces)
const file = readStep(text)

const count = (name: string) => [...file.entities.values()].filter((e) => e.name === name).length
const distinctColours = (list: PartFaces) => new Set(list.flat().map((f) => f.color.join(","))).size

describe("the STEP file with the parts' faces", () => {
  test("keeps the products, and the board alone stays a closed solid of the same volume", () => {
    expect(productNames(file)).toEqual(["main", "board", "R1", "R2", "C1", "J1"])
    const found = solids(file)
    expect(found.map((s) => s.name)).toEqual(["board"])
    expect(found[0]?.closed).toBe(true)
    expect(found[0]?.volume).toBeCloseTo(boardVolume(model.board!), 6)
  })

  test("writes each part as a surface model of its faces: no MANIFOLD_SOLID_BREP for a part with faces", () => {
    const written = surfaces(file)
    expect(written.map((s) => s.name)).toEqual(["R1", "R2", "C1", "J1"])
    written.forEach((surface, i) => expect(surface.faces, surface.name).toBe(faces[i]?.length))
    expect(count("MANIFOLD_SOLID_BREP")).toBe(1)
    expect(count("MANIFOLD_SURFACE_SHAPE_REPRESENTATION")).toBe(4)
    expect(count("OPEN_SHELL")).toBe(4)
    expect(count("ADVANCED_BREP_SHAPE_REPRESENTATION")).toBe(1)
    expect(file.header).toContain("FILE_DESCRIPTION(('The board as a solid and its parts as coloured faces, as copperflow''s 3D view draws them'),'2;1');")
  })

  test("colours every face as given, with one style per distinct colour shared across the parts", () => {
    const written = surfaces(file)
    written.forEach((surface, i) => expect(surface.colours, surface.name).toEqual(faces[i]?.map((f) => [...f.color])))
    const distinct = distinctColours(faces)
    expect(distinct).toBeGreaterThan(1)
    for (const name of ["COLOUR_RGB", "PRESENTATION_STYLE_ASSIGNMENT", "SURFACE_STYLE_USAGE"]) expect(count(name), name).toBe(distinct)
    expect(count("STYLED_ITEM")).toBe(faces.flat().length)
    expect(count("MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION")).toBe(4)
  })

  test("shares the vertices and edges of a part's faces, each edge by at most two faces running opposite ways", () => {
    const corners = faces.flat().reduce((sum, f) => sum + f.loops.reduce((n, loop) => n + loop.length, 0), 0)
    expect(count("VERTEX_POINT")).toBeLessThan(corners / 2)
    for (const surface of surfaces(file)) {
      expect(surface.mostUses, surface.name).toBeLessThanOrEqual(2)
      expect(surface.pairedOpposite, surface.name).toBe(true)
    }
  })

  test("every face's outline runs counter-clockwise about the normal it was given", () => {
    for (const surface of surfaces(file)) {
      for (const { normal, area } of surface.orientation) {
        const along = normal.reduce((sum, c, i) => sum + c * (area[i] ?? 0), 0)
        expect(along, surface.name).toBeGreaterThan(0)
      }
    }
  })

  test("a second run writes the same bytes", () => {
    const again = buildDesign({ [MAIN]: source }, MAIN)
    const againModel = solidModel(again)
    expect(stepText(againModel, "main", stepPartFaces(again, againModel))).toBe(text)
  })

  test("is plain text with Unix line endings and every real written with a decimal point", () => {
    expect(text).not.toContain("\r")
    expect(text).not.toMatch(/[^\x0a\x20-\x7e]/)
    const reals = text.split("\n").filter((line) => /=(CARTESIAN_POINT|DIRECTION|VECTOR|COLOUR_RGB)\(/.test(line))
    for (const line of reals) expect(line).not.toMatch(/[(,]-?\d+[,)]/)
  })
})

/** A unit square at height z, facing up, in `color`. */
const square = (z: number, color: StepFace["color"], alpha = 1): StepFace => ({
  loops: [
    [
      [0, 0, z],
      [1, 0, z],
      [1, 1, z],
      [0, 1, z],
    ],
  ],
  normal: [0, 0, 1],
  color,
  alpha,
})

describe("faces made by hand", () => {
  const two = buildDesign(
    { [MAIN]: `export default () => (<board width="10mm" height="10mm"><resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} /><resistor name="R2" resistance="1k" footprint="0402" pcbX={3} pcbY={0} /></board>)` },
    MAIN,
  )
  const twoModel = solidModel(two)

  test("a loop given clockwise is turned to run counter-clockwise about the normal; a hole the other way", () => {
    const clockwise: StepFace = {
      loops: [
        [
          [0, 0, 1],
          [0, 4, 1],
          [4, 4, 1],
          [4, 0, 1],
        ],
        [
          [1, 1, 1],
          [3, 1, 1],
          [3, 3, 1],
          [1, 3, 1],
        ],
      ],
      normal: [0, 0, 1],
      color: [200, 10, 10],
      alpha: 1,
    }
    const written = readStep(stepText(twoModel, "main", [[clockwise], [square(1, [10, 10, 200])]]))
    const [r1] = surfaces(written)
    expect(r1?.orientation[0]?.area[2]).toBeGreaterThan(0)
    expect([...written.entities.values()].filter((e) => e.name === "FACE_BOUND")).toHaveLength(1)
  })

  test("drops faces without area and repeated corners; a part left with none is a box", () => {
    const sliver: StepFace = { loops: [[[0, 0, 1], [1, 0, 1], [2, 0, 1]]], normal: [0, 0, 1], color: [1, 2, 3], alpha: 1 }
    const doubled: StepFace = { ...square(2, [9, 9, 9]), loops: [[[0, 0, 2], [0, 0, 2], [1, 0, 2], [1, 1, 2], [0, 1, 2], [0, 0, 2]]] }
    const written = readStep(stepText(twoModel, "main", [[sliver, doubled], [sliver]]))
    const [r1] = surfaces(written)
    expect(r1?.faces).toBe(1)
    expect(solids(written).map((s) => s.name)).toEqual(["board", "R2"])
  })

  test("a see-through face is written opaque in its colour, sharing the style of an opaque face of that colour", () => {
    const written = stepText(twoModel, "main", [[square(1, [50, 60, 70], 0.4)], [square(1, [50, 60, 70])]])
    expect(written).toContain("COLOUR_RGB('',0.1961,0.2353,0.2745)")
    expect(written).not.toMatch(/TRANSPARENT/)
    expect(written.match(/=COLOUR_RGB\(/g)).toHaveLength(1)
  })

  test("faces for a different number of parts than the model's are not used: every part is a box", () => {
    const written = stepText(twoModel, "main", [[square(1, [1, 1, 1])]])
    expect(written).not.toContain("SHELL_BASED_SURFACE_MODEL")
    expect(written).toContain("FILE_DESCRIPTION(('The board and its parts as boxes'),'2;1');")
    expect(solids(readStep(written)).map((s) => s.name)).toEqual(["board", "R1", "R2"])
  })

  test("without faces the file is the boxes it always was", () => {
    expect(stepText(twoModel, "main")).toBe(stepText(twoModel, "main", undefined))
    expect(stepText(twoModel, "main")).not.toContain("STYLED_ITEM")
  })
})
