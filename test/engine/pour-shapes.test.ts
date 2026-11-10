import { expect, test } from "vitest"
import { convexHull, shapeOutline } from "../../src/engine/pour/shapes.js"

const area = (points: { x: number; y: number }[]) =>
  points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length] ?? p
    return sum + (p.x * q.y - q.x * p.y) / 2
  }, 0)

test("the hull is counter-clockwise and drops repeated and in-line points", () => {
  expect(convexHull([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 2, y: 2 }])).toEqual([{ x: 0, y: 0 }, { x: 2, y: 2 }])
  const square = convexHull([{ x: 1, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 0.5 }])
  expect(square).toHaveLength(4)
  expect(area(square)).toBe(1)
})

test("a circle is drawn with sides that touch it from outside, within 2 µm", () => {
  const points = shapeOutline({ core: [{ x: 1, y: 2 }], radius: 0.5 })
  const distances = points.map((p) => Math.hypot(p.x - 1, p.y - 2))
  expect(Math.min(...distances)).toBeGreaterThanOrEqual(0.5)
  expect(Math.max(...distances)).toBeLessThanOrEqual(0.5021)
  expect(area(points)).toBeGreaterThan(Math.PI * 0.25)
  expect(points.length).toBeGreaterThanOrEqual(8)
})

test("a segment becomes a capsule and a square grows round corners; a shape with no area has no outline", () => {
  const capsule = shapeOutline({ core: [{ x: 0, y: 0 }, { x: 2, y: 0 }], radius: 0.1 })
  expect(area(capsule)).toBeGreaterThan(0.4 + Math.PI * 0.01)
  expect(area(capsule)).toBeLessThan(0.4 + Math.PI * 0.01 + 0.001)
  const square = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
  expect(shapeOutline({ core: square, radius: 0 })).toEqual(square)
  const grown = shapeOutline({ core: square, radius: 0 }, 0.1)
  expect(area(grown)).toBeCloseTo(1 + 0.4 + Math.PI * 0.01, 3)
  expect(shapeOutline({ core: [{ x: 0, y: 0 }, { x: 1, y: 0 }], radius: 0 })).toEqual([])
})
