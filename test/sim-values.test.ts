import { expect, test } from "vitest"
import { formatQuantity, parseQuantity } from "../src/engine/sim/values.js"

test("reads values with SI prefixes and units", () => {
  expect(parseQuantity("10k")).toBe(10_000)
  expect(parseQuantity("4.7k")).toBeCloseTo(4700)
  expect(parseQuantity("100nF")).toBeCloseTo(1e-7)
  expect(parseQuantity("3.3V")).toBe(3.3)
  expect(parseQuantity("2mA")).toBeCloseTo(0.002)
  expect(parseQuantity("48mohm")).toBeCloseTo(0.048)
  expect(parseQuantity("48mΩ")).toBeCloseTo(0.048)
  expect(parseQuantity("1M")).toBe(1e6)
  expect(parseQuantity("2u")).toBeCloseTo(2e-6)
  expect(parseQuantity("2µA")).toBeCloseTo(2e-6)
  expect(parseQuantity(120)).toBe(120)
  expect(parseQuantity("120")).toBe(120)
  expect(parseQuantity("-1.5V")).toBe(-1.5)
  expect(parseQuantity("1e-3")).toBeCloseTo(0.001)
})

test("refuses what is not a value", () => {
  expect(parseQuantity("ten")).toBeUndefined()
  expect(parseQuantity("10q")).toBeUndefined()
  expect(parseQuantity("")).toBeUndefined()
  expect(parseQuantity(Number.NaN)).toBeUndefined()
  expect(parseQuantity(true)).toBeUndefined()
})

test("writes figures to three significant digits with a prefix and unit", () => {
  expect(formatQuantity(3.4123, "V")).toBe("3.41 V")
  expect(formatQuantity(0.0296, "A")).toBe("29.6 mA")
  expect(formatQuantity(0.355, "W")).toBe("355 mW")
  expect(formatQuantity(12, "V")).toBe("12.0 V")
  expect(formatQuantity(0, "A")).toBe("0 A")
  expect(formatQuantity(-0.0021, "A")).toBe("-2.10 mA")
  expect(formatQuantity(4.2e-9, "A")).toBe("4.20 nA")
  expect(formatQuantity(1500, "Ω")).toBe("1.50 kΩ")
  expect(formatQuantity(1e-16, "A")).toBe("0 A")
  expect(formatQuantity(999.7, "V")).toBe("1.00 kV")
})
