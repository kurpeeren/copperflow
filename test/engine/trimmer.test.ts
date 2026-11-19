// The Bourns 3296W trimmer: its footprint from the maker's drawing, its height, the potentiometer's pins on it, and its
// 3D shape with the value code printed on top.
import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { generateFootprint } from "../../src/engine/footprints/index.js"
import { partHeight } from "../../src/engine/solid/heights.js"
import { solidModel } from "../../src/engine/solid/model.js"
import { familyOf } from "../../studio/src/look/parts/family.js"
import { partFaces } from "../../studio/src/look/parts/index.js"
import { resistanceCode } from "../../studio/src/look/parts/trimmer.js"

describe("trimmer3296w", () => {
  test("three leads 2.54 mm apart down the middle of a 9.53 x 4.83 mm body, pin 1 square", () => {
    const made = generateFootprint("trimmer3296w")
    if ("error" in made) throw new Error(made.error)
    expect(made.pads.map((pad) => [pad.number, pad.x, pad.y, pad.shape])).toEqual([
      ["1", -2.54, 0, "rect"],
      ["2", 0, 0, "circle"],
      ["3", 2.54, 0, "circle"],
    ])
    expect(made.pads.every((pad) => pad.layers === "through" && (pad.drill?.width ?? 0) >= 0.51)).toBe(true)
    const xs = made.fabrication.flat().map((p) => p.x)
    const ys = made.fabrication.flat().map((p) => p.y)
    expect([Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]).toEqual([9.53, 4.83])
    expect(made.origin).toContain("Bourns 3296 data sheet")
  })

  test("is 10.03 mm to the top and 11.55 with its screw, read from the data sheet", () => {
    expect(partHeight({ footprint: "trimmer3296w", props: {} })).toMatchObject({ height: 11.55, state: "read" })
  })

  test("a potentiometer on it has pin1, the wiper on pin2 and pin3 on its pads", () => {
    const design = buildDesign({ "m.circuit.tsx": `export default () => (<board width="20mm" height="20mm"><potentiometer name="RV1" maxResistance="10k" footprint="trimmer3296w" pcbX={0} pcbY={0} /></board>)` }, "m.circuit.tsx")
    const part = design.circuit.components.find((c) => c.id === "RV1")!
    expect(part.pins.map((pin) => pin.names.slice(0, 2).join(" "))).toEqual(["pin1", "pin2 wiper", "pin3"])
    expect(design.pcb.parts[0]!.pads.map((pad) => pad.id)).toEqual(["RV1#1", "RV1#2", "RV1#3"])
  })
})

describe("its 3D shape", () => {
  test("a blue body, a brass screw on top at the pin 1 end, and the value code printed beside it", () => {
    expect(familyOf("potentiometer", "trimmer3296w", true).family).toBe("trimmer")
    const design = buildDesign({ "m.circuit.tsx": `export default () => (<board width="20mm" height="20mm"><potentiometer name="RV1" maxResistance="10k" footprint="trimmer3296w" pcbX={0} pcbY={0} /></board>)` }, "m.circuit.tsx")
    const model = solidModel(design)
    const faces = partFaces(design, model)
    const top = model.parts[0]!.top
    const screw = faces.filter((face) => face.material === "metal" && face.role === "cap" && face.normal[2] > 0.99)
    expect(screw).toHaveLength(1)
    const sx = screw[0]!.loops[0]!.reduce((s, p) => s + p[0], 0) / screw[0]!.loops[0]!.length
    // In the corner at the pin 1 end: 1.27 mm in from the end (x -4.765) and from one long side (y -2.415).
    expect(sx).toBeCloseTo(-4.765 + 1.27, 1)
    const sy = screw[0]!.loops[0]!.reduce((s, p) => s + p[1], 0) / screw[0]!.loops[0]!.length
    expect(sy).toBeCloseTo(-2.415 + 1.27, 1)
    const bodyTop = Math.max(...faces.filter((face) => face.role === "body").flatMap((face) => face.loops[0]!.map((p) => p[2])))
    expect(top - bodyTop).toBeGreaterThan(1.4)
    expect(Math.max(...faces.flatMap((face) => face.loops[0]!.map((p) => p[2])))).toBeCloseTo(top, 6)
    const print = faces.filter((face) => face.role === "body" && face.normal[2] > 0.99 && face.color[0] > 200)
    expect(print.length).toBeGreaterThan(5)
  })

  test("the value code is two digits and the zeros", () => {
    expect(["10k", "1k", "500", "100k", "2M", "4.7k", "22"].map(resistanceCode)).toEqual(["103", "102", "501", "104", "205", "472", "220"])
    expect(resistanceCode("x")).toBeUndefined()
  })
})
