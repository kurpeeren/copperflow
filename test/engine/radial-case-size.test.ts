// Electrolytic cans by rating: the case a general-purpose series (Nichicon UVR) makes a rating in, the height the 3D
// model gives the can from it, the check that warns when the footprint is for another diameter, and the value and
// voltage printed on the sleeve.
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { caseSizeChecks } from "../../src/engine/checks/case-size.js"
import { partHeight } from "../../src/engine/solid/heights.js"
import { radialCase, RADIAL_RATINGS_DOCUMENT, standardSpacing } from "../../src/engine/solid/radial-ratings.js"
import { solidModel } from "../../src/engine/solid/model.js"
import { partFaces } from "../../studio/src/look/parts/index.js"
import { printedLines } from "../../studio/src/look/parts/sleeve-print.js"

const circuit = (footprint: string, props: string) =>
  buildDesign({ "main.circuit.tsx": `export default () => (<board width="30mm" height="30mm"><capacitor name="C1" polarized ${props} footprint="${footprint}" pcbX={0} pcbY={0} /></board>)` }, "main.circuit.tsx")

describe("the case a rating is made in", () => {
  test("reads the series' table, whatever way the value is written", () => {
    expect(radialCase({ capacitance: "1000uF", voltageRating: "16V" })).toEqual({ volts: 16, microfarads: 1000, diameter: 10, length: 16 })
    expect(radialCase({ capacitance: "470µF", voltageRating: 25 })).toMatchObject({ diameter: 10, length: 12.5 })
    expect(radialCase({ capacitance: 4.7e-6, maxVoltageRating: "200V" })).toMatchObject({ diameter: 8, length: 11.5 })
  })

  test("has no case for a rating the table does not list, or without a voltage", () => {
    expect(radialCase({ capacitance: "10uF", voltageRating: "16V" })).toBeUndefined()
    expect(radialCase({ capacitance: "1000uF" })).toBeUndefined()
    expect(radialCase({ voltageRating: "16V" })).toBeUndefined()
  })
})

describe("the can's height", () => {
  test("is the series' length when the footprint is for that diameter, read from its data sheet", () => {
    const height = partHeight({ footprint: "radial10x5", props: { capacitance: "1000uF", voltageRating: "16V" } })
    expect(height).toMatchObject({ height: 16, state: "read" })
    expect(height.source).toContain(RADIAL_RATINGS_DOCUMENT)
    expect(partHeight({ footprint: "radial10x5", props: { capacitance: "470uF", voltageRating: "25V" } }).height).toBe(12.5)
  })

  test("stays the common length for the diameter when the rating is not listed or the diameter differs", () => {
    const common = partHeight({ footprint: "radial10x5", props: {} })
    expect(common.state).toBe("typical")
    expect(partHeight({ footprint: "radial10x5", props: { capacitance: "10uF", voltageRating: "16V" } }).height).toBe(common.height)
    expect(partHeight({ footprint: "radial8x3.5", props: { capacitance: "1000uF", voltageRating: "16V" } }).state).toBe("typical")
  })

  test("a given height still wins", () => {
    expect(partHeight({ footprint: "radial10x5", props: { capacitance: "1000uF", voltageRating: "16V", height: "20mm" } }).height).toBe(20)
  })
})

describe("the case-size check", () => {
  test("warns when the rating's can is another diameter than the footprint's", () => {
    const found = caseSizeChecks(circuit("radial8x3.5", `capacitance="1000uF" voltageRating="16V"`).circuit)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ code: "case-size", severity: "warning", items: ["C1"] })
    expect(found[0]!.message).toContain("10 x 16 mm")
    expect(found[0]!.message).toContain("an 8 mm can")
  })

  test("is quiet when the footprint fits, or the rating is not listed", () => {
    expect(caseSizeChecks(circuit("radial10x5", `capacitance="1000uF" voltageRating="16V"`).circuit)).toEqual([])
    expect(caseSizeChecks(circuit("radial5x2", `capacitance="10uF" voltageRating="16V"`).circuit)).toEqual([])
    expect(caseSizeChecks(circuit("radial5x2", `capacitance="10uF"`).circuit)).toEqual([])
  })
})

describe("the lead-spacing check", () => {
  test("knows the spacing makers set for each listed can", () => {
    expect([5, 6.3, 8, 10, 12.5, 16, 18, 20, 22, 25].map(standardSpacing)).toEqual([2, 2.5, 3.5, 5, 5, 7.5, 7.5, 10, 10, 12.5])
    expect(standardSpacing(4)).toBeUndefined()
  })

  test("warns when a footprint's leads are not as far apart as makers set them, naming the footprint to use", () => {
    const found = caseSizeChecks(circuit("radial10x3.5", `capacitance="100uF"`).circuit)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ code: "lead-spacing", severity: "warning", items: ["C1"] })
    expect(found[0]!.message).toContain("3.5 mm apart")
    expect(found[0]!.message).toContain("radial10x5")
  })

  test("is quiet for the standard spacing and for a can makers do not list", () => {
    for (const footprint of ["radial5x2", "radial6.3x2.5", "radial8x3.5", "radial10x5", "radial16x7.5"]) expect(caseSizeChecks(circuit(footprint, ``).circuit), footprint).toEqual([])
    expect(caseSizeChecks(circuit("radial4x1.5", ``).circuit)).toEqual([])
  })
})

describe("the print on the sleeve", () => {
  test("is the value in µF and the rated voltage, as makers print them", () => {
    expect(printedLines({ capacitance: "1000uF", voltageRating: "16V" })).toEqual(["1000µF", "16V"])
    expect(printedLines({ capacitance: "4.7uF", voltageRating: "6.3V" })).toEqual(["4.7µF", "6.3V"])
    expect(printedLines({ capacitance: "0.47uF" })).toEqual(["0.47µF"])
    expect(printedLines({})).toEqual([])
  })

  test("lies on the can's side, a flat piece each, as the can's height says", () => {
    const design = circuit("radial10x5", `capacitance="1000uF" voltageRating="16V"`)
    const model = solidModel(design)
    const faces = partFaces(design, model)
    const can = model.parts[0]!
    const sides = faces.filter((face) => face.role === "body" && Math.abs(face.normal[2]) < 1e-9)
    expect(can.top - can.bottom).toBeCloseTo(16, 6)
    // The print: many small strips standing just off the can's side, every one of them inside the sleeve's height.
    const radius = Math.max(...sides.flatMap((face) => face.loops[0]!.map((p) => Math.hypot(p[0], p[1]))))
    const print = sides.filter((face) => face.loops[0]!.every((p) => Math.hypot(p[0], p[1]) > radius - 0.02))
    expect(print.length).toBeGreaterThan(50)
    for (const face of print) for (const p of face.loops[0]!) expect(p[2]).toBeGreaterThan(can.bottom + 1)
    const plain = partFaces(circuit("radial10x5", ``), solidModel(circuit("radial10x5", ``)))
    expect(plain.length).toBeLessThan(faces.length - 50)
  })

  test("a surface-mount can carries it flat on its lid", () => {
    const can = (props: string) => {
      const design = buildDesign({ "main.circuit.tsx": `export default () => (<board width="30mm" height="30mm"><capacitor name="C1" polarized ${props} footprint="smdcan6.3x5.4" pcbX={0} pcbY={0} /></board>)` }, "main.circuit.tsx")
      const model = solidModel(design)
      return { faces: partFaces(design, model), top: model.parts[0]!.top }
    }
    const printed = can(`capacitance="47uF" voltageRating="16V"`)
    const plain = can(``)
    const ink = printed.faces.filter((face) => face.normal[2] > 0.99 && face.loops[0]!.every((p) => p[2] > printed.top - 0.01))
    expect(printed.faces.length - plain.faces.length).toBeGreaterThan(20)
    expect(ink.length).toBeGreaterThan(20)
  })
})
