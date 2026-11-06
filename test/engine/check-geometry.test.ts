import { describe, expect, test } from "vitest"
import {
  bounds,
  closestPoints,
  drillShape,
  padShape,
  pointInPolygon,
  polygonsOverlap,
  shapeDistance,
  shapeToSegmentDistance,
} from "../../src/engine/checks/geometry.js"
import { GridIndex } from "../../src/engine/checks/grid-index.js"
import type { WorldPad } from "../../src/engine/pcb.js"

function pad(overrides: Partial<WorldPad>): WorldPad {
  return {
    number: "1",
    shape: "rect",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    layers: "top",
    id: "U1#1",
    component: "U1",
    ...overrides,
  }
}

const shapeOf = (p: Partial<WorldPad>) => {
  const shape = padShape(pad(p))
  if (shape === undefined) throw new Error("no shape")
  return shape
}

describe("shapeDistance", () => {
  test("two 1x1 rects with centres 3 mm apart are 2 mm apart", () => {
    const d = shapeDistance(shapeOf({}), shapeOf({ x: 3 }))
    expect(d).toBeCloseTo(2, 9)
  })

  test("a circle of radius 0.5 beside a rect edge 1 mm from its centre keeps 0.5", () => {
    const rect = shapeOf({ x: 0, width: 2, height: 2 })
    const circle = shapeOf({ shape: "circle", x: 2, width: 1, height: 1 })
    expect(shapeDistance(rect, circle)).toBeCloseTo(0.5, 9)
  })

  test("overlapping circles give a negative distance", () => {
    const a = shapeOf({ shape: "circle" })
    const b = shapeOf({ shape: "circle", x: 0.6 })
    expect(shapeDistance(a, b)).toBeCloseTo(-0.4, 9)
  })

  test("a rotated oval matches the equivalent capsule", () => {
    const oval = shapeOf({ shape: "oval", width: 3, height: 1, rotation: 90 })
    const other = shapeOf({ shape: "circle", x: 2, width: 1, height: 1 })
    // the oval stands up along y, so its right edge is at x = 0.5
    expect(shapeDistance(oval, other)).toBeCloseTo(1, 9)
    const capsule: { core: { x: number; y: number }[]; radius: number } = {
      core: [
        { x: 0, y: -1 },
        { x: 0, y: 1 },
      ],
      radius: 0.5,
    }
    expect(shapeDistance(oval, other)).toBeCloseTo(shapeDistance(capsule, other), 9)
  })

  test("an oval with equal sides is a circle", () => {
    const shape = shapeOf({ shape: "oval", width: 2, height: 2 })
    expect(shape.core).toHaveLength(1)
    expect(shape.radius).toBeCloseTo(1, 9)
  })

  test("a roundrect corner keeps a larger gap than a plain rect at 45 degrees", () => {
    const circle = shapeOf({ shape: "circle", x: 2, y: 2, width: 1, height: 1 })
    const plain = shapeOf({ width: 2, height: 2 })
    const rounded = shapeOf({ shape: "roundrect", width: 2, height: 2, cornerRadius: 0.5 })
    expect(shapeDistance(rounded, circle)).toBeGreaterThan(shapeDistance(plain, circle) + 0.1)
  })

  test("a roundrect without cornerRadius behaves like a rect", () => {
    const circle = shapeOf({ shape: "circle", x: 2, y: 2, width: 1, height: 1 })
    const plain = shapeOf({ width: 2, height: 2 })
    const rounded = shapeOf({ shape: "roundrect", width: 2, height: 2 })
    expect(shapeDistance(rounded, circle)).toBeCloseTo(shapeDistance(plain, circle), 9)
  })

  test("a rect inside a bigger rect is zero apart", () => {
    const big = shapeOf({ width: 4, height: 4 })
    expect(shapeDistance(big, shapeOf({ width: 1, height: 1 }))).toBeCloseTo(0, 9)
  })

  test("crossing rects without any corner inside each other are zero apart", () => {
    const wide = shapeOf({ width: 4, height: 1 })
    const tall = shapeOf({ width: 1, height: 4 })
    expect(shapeDistance(wide, tall)).toBeCloseTo(0, 9)
  })
})

describe("padShape and drillShape", () => {
  test("a pad with an unknown shape has no shape", () => {
    expect(padShape(pad({ shape: "hexagon" as WorldPad["shape"] }))).toBeUndefined()
  })

  test("a pad without a drill has no hole", () => {
    expect(drillShape(pad({}))).toBeUndefined()
  })

  test("a round drill is one point", () => {
    const hole = drillShape(pad({ x: 1, y: 2, drill: { width: 0.8, height: 0.8 } }))
    expect(hole?.core).toEqual([{ x: 1, y: 2 }])
    expect(hole?.radius).toBeCloseTo(0.4, 9)
  })

  test("a slot taller than wide runs along the pad y axis and turns with the pad", () => {
    const hole = drillShape(pad({ rotation: 90, drill: { width: 0.6, height: 1.6 } }))
    expect(hole?.radius).toBeCloseTo(0.3, 9)
    const xs = hole?.core.map((p) => p.x) ?? []
    const ys = hole?.core.map((p) => p.y) ?? []
    expect(Math.max(...xs.map(Math.abs))).toBeCloseTo(0.5, 9)
    expect(Math.max(...ys.map(Math.abs))).toBeCloseTo(0, 9)
  })
})

describe("closestPoints and shapeToSegmentDistance", () => {
  test("closest points of two separated circles lie on their facing edges", () => {
    const a = shapeOf({ shape: "circle" })
    const b = shapeOf({ shape: "circle", x: 3 })
    const [p, q] = closestPoints(a, b)
    expect(p.x).toBeCloseTo(0.5, 9)
    expect(q.x).toBeCloseTo(2.5, 9)
  })

  test("a segment 1 mm above a circle of radius 0.5 is 0.5 away", () => {
    const circle = shapeOf({ shape: "circle" })
    const d = shapeToSegmentDistance(circle, { x: -2, y: 1 }, { x: 2, y: 1 })
    expect(d).toBeCloseTo(0.5, 9)
  })

  test("a segment through a rect is at distance zero", () => {
    const d = shapeToSegmentDistance(shapeOf({}), { x: -2, y: 0 }, { x: 2, y: 0 })
    expect(d).toBeCloseTo(0, 9)
  })
})

describe("polygons", () => {
  const square = (x: number) => [
    { x, y: 0 },
    { x: x + 1, y: 0 },
    { x: x + 1, y: 1 },
    { x, y: 1 },
  ]

  test("squares sharing an edge do not overlap", () => {
    expect(polygonsOverlap(square(0), square(1))).toBe(false)
  })

  test("squares overlapping by 0.1 mm do", () => {
    expect(polygonsOverlap(square(0), square(0.9))).toBe(true)
  })

  test("pointInPolygon tells inside from outside", () => {
    expect(pointInPolygon({ x: 0.5, y: 0.5 }, square(0))).toBe(true)
    expect(pointInPolygon({ x: 1.5, y: 0.5 }, square(0))).toBe(false)
  })

  test("bounds include the radius", () => {
    const box = bounds(shapeOf({ shape: "circle", x: 1, y: 2, width: 1, height: 1 }))
    expect(box).toEqual({ minX: 0.5, minY: 1.5, maxX: 1.5, maxY: 2.5 })
  })
})

describe("GridIndex", () => {
  test("an item spanning four cells is returned once", () => {
    const index = new GridIndex<string>(2)
    index.insert("a", { minX: 1, minY: 1, maxX: 3, maxY: 3 })
    expect(index.query({ minX: 0, minY: 0, maxX: 4, maxY: 4 })).toEqual(["a"])
  })

  test("far away items are not returned", () => {
    const index = new GridIndex<string>(2)
    index.insert("a", { minX: 0, minY: 0, maxX: 1, maxY: 1 })
    index.insert("b", { minX: 20, minY: 20, maxX: 21, maxY: 21 })
    expect(index.query({ minX: -1, minY: -1, maxX: 2, maxY: 2 })).toEqual(["a"])
  })
})
