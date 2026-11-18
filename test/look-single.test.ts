import { describe, expect, test } from "vitest"
import { lonePart, loneScene } from "../studio/src/look/parts/single.js"

const ok = (text: string, kind?: string) => {
  const part = lonePart(text, kind)
  if ("error" in part) throw new Error(part.error)
  return part
}

describe("a lone part's faces", () => {
  test("soic8: a body and leads, standing on z = 0, as tall as the height table says", () => {
    const part = ok("soic8")
    expect(part.faces.some((face) => face.role === "body")).toBe(true)
    expect(part.faces.some((face) => face.role === "leg" || face.role === "lead")).toBe(true)
    const [min, max] = part.bounds
    expect(min[2]).toBeGreaterThanOrEqual(-1e-9)
    expect(max[2]).toBeCloseTo(part.height.height, 1)
    expect(max[0] - min[0]).toBeGreaterThan(4)
  })

  test("to220 has leads below the board's top and a tab", () => {
    const part = ok("to220")
    expect(part.faces.length).toBeGreaterThan(10)
    expect(part.bounds[0][2]).toBeLessThan(0)
  })

  test("0603 as a resistor is a chip with end caps", () => {
    const part = ok("0603", "resistor")
    expect(part.faces.some((face) => face.role === "cap")).toBe(true)
    expect(part.bounds[1][0] - part.bounds[0][0]).toBeLessThan(2)
  })

  test("every face belongs to part 0", () => {
    expect(ok("sot23").faces.every((face) => face.part === 0)).toBe(true)
  })

  test("an unknown string gives a clear error, not a throw", () => {
    expect(lonePart("nonsense42")).toHaveProperty("error")
    expect(lonePart("")).toHaveProperty("error")
    expect(lonePart("parts/x/footprint.yaml")).toHaveProperty("error")
  })

  test("the scene puts the part on a small patch of board below it", () => {
    const part = ok("soic8")
    const scene = loneScene(part)
    expect(scene.faces.length).toBeGreaterThan(part.faces.length)
    expect(scene.faces.some((face) => face.role === "board" && face.part === -1)).toBe(true)
    expect(scene.bounds[0][0]).toBeLessThan(part.bounds[0][0])
  })
})
