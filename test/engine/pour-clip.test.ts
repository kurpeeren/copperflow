import { expect, test } from "vitest"
import { difference, intersection, offset, pathArea, regionArea, regionHolds, regions, toPath, toPoints, union } from "../../src/engine/pour/clip.js"

const square = (x: number, y: number, size: number) =>
  toPath([
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ])

const total = (paths: ReturnType<typeof union>) => paths.reduce((sum, path) => sum + pathArea(path), 0)

test("coordinates are rounded to whole micrometres on the way in", () => {
  expect(toPath([{ x: 1.0004, y: -0.0006 }])).toEqual([{ X: 1000, Y: -1 }])
  expect(toPoints([{ X: 1234, Y: -5 }])).toEqual([{ x: 1.234, y: -0.005 }])
})

test("union, difference and intersection of two overlapping squares", () => {
  const a = [square(0, 0, 2)]
  const b = [square(1, 1, 2)]
  expect(total(union([...a, ...b]))).toBe(7_000_000)
  expect(total(difference(a, b))).toBe(3_000_000)
  expect(total(intersection(a, b))).toBe(1_000_000)
})

test("a clockwise input comes out counter-clockwise", () => {
  const [path] = union([[...square(0, 0, 1)].reverse()])
  expect(pathArea(path ?? [])).toBeGreaterThan(0)
})

test("a miter offset keeps a square square; a round one rounds it", () => {
  const shrunk = offset([square(0, 0, 10)], -1, "miter")
  expect(total(shrunk)).toBe(64_000_000)
  const grown = offset([square(0, 0, 10)], 1, "round")
  expect(total(grown)).toBeLessThan(144_000_000)
  expect(total(grown)).toBeGreaterThan(143_000_000)
})

test("regions split an area into outlines with their holes", () => {
  const frame = difference([square(0, 0, 10)], [square(2, 2, 6)])
  const pieces = regions([...frame, square(4, 4, 2), square(20, 0, 1)])
  expect(pieces).toHaveLength(3)
  const big = pieces.find((piece) => piece.holes.length === 1)
  expect(big && regionArea(big)).toBe(64_000_000)
  expect(big && regionHolds(big, { X: 1000, Y: 1000 })).toBe(true)
  expect(big && regionHolds(big, { X: 5000, Y: 5000 })).toBe(false)
  expect(big && regionHolds(big, { X: 0, Y: 5000 })).toBe(true)
})
