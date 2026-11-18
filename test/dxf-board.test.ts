import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { ARC_TOLERANCE, boardFromDxf, type BoardFromDrawing } from "../src/engine/dxf/index.js"
import type { Point } from "../src/engine/model.js"

const fixture = (name: string) => readFileSync(new URL(`./fixtures/dxf/${name}`, import.meta.url), "utf8")

function size(points: readonly Point[]) {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

/** The largest distance from the middle of an outline edge to the circle of a rounded corner, among edges near it. */
function worstArcError(board: BoardFromDrawing, centre: Point, radius: number): number {
  const n = board.outline.length
  let worst = 0
  for (let i = 0; i < n; i++) {
    const a = board.outline[i] as Point
    const b = board.outline[(i + 1) % n] as Point
    const onCircle = (p: Point) => Math.abs(Math.hypot(p.x - centre.x, p.y - centre.y) - radius) < 1e-3
    if (!onCircle(a) || !onCircle(b)) continue
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    worst = Math.max(worst, radius - Math.hypot(middle.x - centre.x, middle.y - centre.y))
  }
  return worst
}

describe("the board from a drawing", () => {
  test("a rectangle with four circles: four corners, four holes, centred on the origin", () => {
    const board = boardFromDxf(fixture("rectangle-holes.dxf"))
    expect(board.outline).toHaveLength(4)
    expect(size(board.outline)).toEqual({ width: 82, height: 54 })
    expect(board.offset).toEqual({ x: -41, y: -27 })
    expect(board.holes).toEqual([
      { x: -37, y: -23, diameter: 3.2 },
      { x: 37, y: -23, diameter: 3.2 },
      { x: 37, y: 23, diameter: 3.2 },
      { x: -37, y: 23, diameter: 3.2 },
    ])
    expect(board.keepouts).toEqual([])
    expect(board.units).toEqual({ name: "mm", from: "file" })
    expect(board.notUsed).toEqual([])
  })

  test("origin keep leaves the drawing where it was drawn", () => {
    const board = boardFromDxf(fixture("rectangle-holes.dxf"), { origin: "keep" })
    expect(board.offset).toEqual({ x: 0, y: 0 })
    expect(board.holes[0]).toEqual({ x: 4, y: 4, diameter: 3.2 })
  })

  test("a rounded rectangle of lines and arcs joins into one loop within 0.02 mm of the arcs", () => {
    const board = boardFromDxf(fixture("rounded.dxf"))
    expect(size(board.outline)).toEqual({ width: 60, height: 40 })
    expect(board.outline.length).toBeGreaterThan(8)
    // The corner at (55, 5) of the drawing is at (25, -15) once centred.
    const error = worstArcError(board, { x: 25, y: -15 }, 5)
    expect(error).toBeGreaterThan(0)
    expect(error).toBeLessThanOrEqual(0.02)
    expect(board.notUsed).toEqual([])
  })

  test("the same drawing in inches comes out in mm", () => {
    const board = boardFromDxf(fixture("rounded-inch.dxf"))
    expect(board.units).toEqual({ name: "inch", from: "file" })
    const { width, height } = size(board.outline)
    expect(width).toBeCloseTo(50.8, 4)
    expect(height).toBeCloseTo(38.1, 4)
    expect(worstArcError(board, { x: 25.4 - 6.35, y: -(19.05 - 6.35) }, 6.35)).toBeLessThanOrEqual(0.02)
  })

  test("units overrides the header", () => {
    const board = boardFromDxf(fixture("rectangle-holes.dxf"), { units: "inch" })
    expect(board.units).toEqual({ name: "inch", from: "asked" })
    expect(size(board.outline).width).toBeCloseTo(82 * 25.4, 4)
  })

  test("an inner closed shape is a keepout; a file without units is read as mm; a circle outside is not used", () => {
    const board = boardFromDxf(fixture("inner-shape.dxf"))
    expect(board.units).toEqual({ name: "mm", from: "assumed" })
    expect(size(board.outline)).toEqual({ width: 100, height: 60 })
    expect(board.keepouts).toHaveLength(1)
    expect(size(board.keepouts[0] as Point[])).toEqual({ width: 20, height: 10 })
    expect(board.keepouts[0]).toContainEqual({ x: -10, y: -10 })
    expect(board.holes).toEqual([])
    expect(board.notUsed).toEqual(["1 circle outside the outline"])
  })

  test("a SPLINE and an open chain are counted, not used", () => {
    const board = boardFromDxf(fixture("spline-open.dxf"))
    expect(size(board.outline)).toEqual({ width: 50, height: 30 })
    expect(board.notUsed).toEqual(["2 SPLINE", "1 open chain of 3 lines"])
  })

  test("bulges become arcs within the arc tolerance", () => {
    const board = boardFromDxf(fixture("bulges.dxf"))
    const { width, height } = size(board.outline)
    // Each half circle's corners lie on it, so the width falls short of 60 by at most the tolerance on each side.
    expect(60 - width).toBeGreaterThanOrEqual(0)
    expect(60 - width).toBeLessThanOrEqual(2 * ARC_TOLERANCE)
    expect(height).toBeCloseTo(20, 6)
    // The right half circle is centred at (40, 10) of the drawing: (20, 0) once centred.
    const error = worstArcError(board, { x: 20, y: 0 }, 10)
    expect(error).toBeGreaterThan(0)
    expect(error).toBeLessThanOrEqual(ARC_TOLERANCE)
  })

  test("layer picks the outline from that layer only", () => {
    const board = boardFromDxf(fixture("inner-shape.dxf"), { layer: "Cutout" })
    expect(size(board.outline)).toEqual({ width: 20, height: 10 })
    expect(board.keepouts).toEqual([])
    expect(board.notUsed).toContain("1 closed shape outside the outline")
    expect(() => boardFromDxf(fixture("inner-shape.dxf"), { layer: "Nope" })).toThrow(/No closed shape on layer Nope; the layers are Board, Cutout, Holes/)
  })

  test("refuses a drawing with no closed shape, and one with two of the same largest area", () => {
    const entities = (body: string) => `0\nSECTION\n2\nENTITIES\n${body}0\nENDSEC\n0\nEOF\n`
    const line = (x1: number, y1: number, x2: number, y2: number) => `0\nLINE\n8\n0\n10\n${x1}\n20\n${y1}\n11\n${x2}\n21\n${y2}\n`
    const square = (x: number) => `0\nLWPOLYLINE\n8\n0\n90\n4\n70\n1\n10\n${x}\n20\n0\n10\n${x + 10}\n20\n0\n10\n${x + 10}\n20\n10\n10\n${x}\n20\n10\n`
    expect(() => boardFromDxf(entities(line(0, 0, 10, 0) + line(10, 0, 10, 10)))).toThrow(/No closed shape was found: 1 open chain of 2 lines/)
    expect(() => boardFromDxf(entities(square(0) + square(20)))).toThrow(/Two closed shapes have the same largest area/)
  })
})
