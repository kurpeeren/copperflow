// Loading the parts' shapes for a STEP file from the renderer: the faces when it can, and why not when it cannot.
import { describe, expect, test } from "vitest"
import { loadPartShapes } from "../src/core/part-shapes.js"
import { buildDesign } from "../src/engine/design.js"
import { modelLine } from "../src/engine/solid/limits.js"
import { solidModel } from "../src/engine/solid/model.js"

const MAIN = "main.circuit.tsx"
const design = buildDesign(
  { [MAIN]: `export default () => (<board width="10mm" height="10mm"><resistor name="R1" resistance="1k" footprint="0402" pcbX={0} pcbY={0} /><chip name="U1" pcbX={3} pcbY={3} /></board>)` },
  MAIN,
)
const model = solidModel(design)
const renderer = () => import("../studio/src/render/node-render.js")

describe("loadPartShapes", () => {
  test("gives each part of the model its faces from the renderer", async () => {
    const shapes = await loadPartShapes(design, model, renderer)
    expect(shapes.missing).toBeUndefined()
    expect(shapes.faces).toHaveLength(2)
    for (const faces of shapes.faces ?? []) expect(faces.length).toBeGreaterThan(0)
  })

  test("a model without parts needs no renderer", async () => {
    const bare = solidModel(buildDesign({ [MAIN]: `export default () => (<board width="10mm" height="10mm" />)` }, MAIN))
    expect(await loadPartShapes(design, bare, () => Promise.reject(new Error("not called")))).toEqual({})
  })

  test("says why when the bundle is missing, has no shapes, fails or shapes the wrong number of parts", async () => {
    const missing = Object.assign(new Error("Cannot find module 'C:/somewhere/dist/render/render.js'"), { code: "ERR_MODULE_NOT_FOUND" })
    expect(await loadPartShapes(design, model, () => Promise.reject(missing))).toEqual({ missing: "the renderer bundle dist/render/render.js is missing; npm run build makes it" })
    expect(await loadPartShapes(design, model, () => Promise.resolve({}))).toEqual({ missing: "the renderer bundle has no part shapes; rebuild it with npm run build" })
    const failing = { stepPartFaces: () => { throw new Error("no family for X1\nat line 3") } }
    expect(await loadPartShapes(design, model, () => Promise.resolve(failing))).toEqual({ missing: "no family for X1" })
    expect(await loadPartShapes(design, model, () => Promise.resolve({ stepPartFaces: () => [[]] }))).toEqual({ missing: "the renderer shaped a different number of parts than the model holds" })
  })
})

describe("the model line", () => {
  const parts = [{ name: "R1", state: "typical" as const }]
  test("names the shapes, the boxes, or the boxes and why", () => {
    expect(modelLine("led.step", parts, { faces: [[]] })).toBe(
      "led.step: parts are the 3D view's shapes as coloured faces (surfaces, not solids), not their real models; heights marked typical come from a package table, assumed ones are guesses (typical: R1; none assumed).",
    )
    expect(modelLine("led.step", parts)).toBe("led.step: parts are boxes, not their real shapes; heights marked typical come from a package table, assumed ones are guesses (typical: R1; none assumed).")
    expect(modelLine("led.step", parts, { missing: "the bundle is missing" })).toBe(
      "led.step: parts are boxes, not their real shapes, since their 3D shapes could not be loaded (the bundle is missing); heights marked typical come from a package table, assumed ones are guesses (typical: R1; none assumed).",
    )
  })
})
