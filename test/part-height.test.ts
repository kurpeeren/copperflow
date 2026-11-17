import { describe, expect, test } from "vitest"
import { generateComponent, PartSchema, type Part } from "../src/core/library.js"

const BASE: Part = {
  title: "Regulator",
  footprint: "sot23_5",
  pins: { "1": { name: "VIN", type: "power_in" } },
}

describe("a library part's height", () => {
  test("part.yaml takes a height in mm, above 0", () => {
    expect(PartSchema.parse({ ...BASE, height: 1.1 }).height).toBe(1.1)
    expect(() => PartSchema.parse({ ...BASE, height: 0 })).toThrow()
    expect(() => PartSchema.parse({ ...BASE, height: "tall" })).toThrow()
  })

  test("the generated component passes it on as the height prop, before the instance's own props", () => {
    const text = generateComponent("ldo", { ...BASE, height: 1.1 })
    expect(text).toContain("    height={1.1}\n")
    expect(text.indexOf("height={1.1}")).toBeLessThan(text.indexOf("{...props}"))
  })

  test("a part without one generates no height", () => {
    expect(generateComponent("ldo", BASE)).not.toContain("height")
  })
})
