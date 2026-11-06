import { expect, test } from "vitest"
import { parseAngle, parseLength } from "../../src/engine/units.js"

test("lengths come out in millimetres", () => {
  expect(parseLength("2.54mm")).toBe(2.54)
  expect(parseLength("0.1in")).toBeCloseTo(2.54)
  expect(parseLength("100mil")).toBeCloseTo(2.54)
  expect(parseLength(3)).toBe(3)
  expect(parseLength("2.54")).toBe(2.54)
  expect(parseLength(" -1.5 mm ")).toBe(-1.5)
})

test("lengths that are not lengths are undefined", () => {
  expect(parseLength("wide")).toBeUndefined()
  expect(parseLength("")).toBeUndefined()
  expect(parseLength(Number.NaN)).toBeUndefined()
  expect(parseLength(Infinity)).toBeUndefined()
  expect(parseLength(undefined)).toBeUndefined()
  expect(parseLength({})).toBeUndefined()
})

test("angles are degrees in [0, 360)", () => {
  expect(parseAngle(-90)).toBe(270)
  expect(parseAngle("90deg")).toBe(90)
  expect(parseAngle(450)).toBe(90)
  expect(parseAngle("45")).toBe(45)
  expect(parseAngle(360)).toBe(0)
  expect(parseAngle("turn")).toBeUndefined()
  expect(parseAngle(null)).toBeUndefined()
})
