// A single through-hole solder pad for a wire: the land and hole the string gives, a refusal for a ring too thin to
// make, and no body in 3D, only the tinned pad the board picture shows.
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { generateFootprint } from "../../src/engine/footprints/index.js"
import { solidModel } from "../../src/engine/solid/model.js"
import { familyOf } from "../../studio/src/look/parts/family.js"
import { partFaces } from "../../studio/src/look/parts/index.js"

describe("wirepad<land>_d<hole>", () => {
  test("one round plated pad with the land and hole given", () => {
    const made = generateFootprint("wirepad2.5_d1.2")
    if ("error" in made) throw new Error(made.error)
    expect(made.pads).toHaveLength(1)
    expect(made.pads[0]).toMatchObject({ number: "1", shape: "circle", x: 0, y: 0, width: 2.5, height: 2.5, layers: "through", drill: { width: 1.2, height: 1.2 } })
  })

  test("a ring too thin to make, or a string without its hole, is refused saying what to write", () => {
    expect(generateFootprint("wirepad1.4_d1.2")).toMatchObject({ error: expect.stringContaining("at least 1.7 mm") })
    expect(generateFootprint("wirepad2")).toMatchObject({ error: expect.stringContaining("wirepad<land>_d<hole>") })
  })

  test("a header or test point on it has no body in 3D, only its pad", () => {
    expect(familyOf("pinheader", "wirepad2_d1", true).family).toBe("bare")
    const design = buildDesign({ "m.circuit.tsx": `export default () => (<board width="10mm" height="10mm"><pinheader name="J1" pinCount={1} footprint="wirepad2_d1" pcbX={0} pcbY={0} /></board>)` }, "m.circuit.tsx")
    expect(design.pcb.parts[0]!.pads).toHaveLength(1)
    expect(partFaces(design, solidModel(design))).toEqual([])
  })
})
