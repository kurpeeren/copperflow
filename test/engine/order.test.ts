import { describe, expect, test } from "vitest"
import { naturalCompare, sortedNatural } from "../../src/engine/order.js"

describe("naturalCompare", () => {
  test("puts numbers in numeric order", () => {
    expect(sortedNatural(["pin10", "pin2", "pin1"])).toEqual(["pin1", "pin2", "pin10"])
  })

  test("orders names the collator ranks equal by code point, whatever order they come in", () => {
    expect(naturalCompare("R01", "R1")).toBeLessThan(0)
    expect(naturalCompare("R1", "R01")).toBeGreaterThan(0)
    expect(sortedNatural(["R1#2", "R01#2"])).toEqual(["R01#2", "R1#2"])
    expect(sortedNatural(["R01#2", "R1#2"])).toEqual(["R01#2", "R1#2"])
  })

  test("is zero only for the same string", () => {
    expect(naturalCompare("R1", "R1")).toBe(0)
    expect(naturalCompare("R1", "r1")).not.toBe(0)
  })
})
