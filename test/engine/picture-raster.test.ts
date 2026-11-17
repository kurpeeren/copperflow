import { describe, expect, test } from "vitest"
import { band, box, capsule, disc, emptyCoverage, gridFor, polygons, toPixel } from "../../src/engine/fab/picture/raster.js"

const at = (layer: { width: number; data: Float32Array }, x: number, y: number) => layer.data[y * layer.width + x] as number
const sum = (layer: { data: Float32Array }) => layer.data.reduce((a, b) => a + b, 0)

describe("coverage images", () => {
  test("a band covers the share of a pixel it overlaps", () => {
    expect(band(0, 2)).toBe(1)
    expect(band(2, 2)).toBeCloseTo(0.5)
    expect(band(3, 2)).toBe(0)
    expect(band(0, 0.25)).toBeCloseTo(0.5)
  })

  test("a disc's covered area is its true area, its middle full and its outside empty", () => {
    const layer = emptyCoverage({ width: 40, height: 40 })
    disc(layer, { x: 20.5, y: 20.5 }, 10)
    expect(sum(layer)).toBeCloseTo(Math.PI * 100, -0.5)
    expect(at(layer, 20, 20)).toBe(1)
    expect(at(layer, 0, 0)).toBe(0)
    const edge = at(layer, 30, 20)
    expect(edge).toBeGreaterThan(0.3)
    expect(edge).toBeLessThan(0.7)
  })

  test("a line covers its length times its width; a clear shape cuts what is under it", () => {
    const layer = emptyCoverage({ width: 60, height: 20 })
    capsule(layer, { x: 10, y: 10 }, { x: 50, y: 10 }, 2)
    expect(sum(layer)).toBeCloseTo(40 * 4 + Math.PI * 4, -0.5)
    disc(layer, { x: 30, y: 10 }, 3, "clear")
    expect(at(layer, 30, 10)).toBeCloseTo(0)
    expect(at(layer, 15, 10)).toBe(1)
  })

  test("a box, square or rounded, turned or not, covers its area", () => {
    const square = emptyCoverage({ width: 40, height: 40 })
    box(square, { x: 20, y: 20 }, 8, 4, 0, 0)
    expect(sum(square)).toBeCloseTo(128, 3)
    const turned = emptyCoverage({ width: 40, height: 40 })
    box(turned, { x: 20, y: 20 }, 8, 4, Math.PI / 6, 0)
    expect(sum(turned)).toBeCloseTo(128, -0.5)
    const rounded = emptyCoverage({ width: 40, height: 40 })
    box(rounded, { x: 20, y: 20 }, 8, 4, 0, 2)
    expect(sum(rounded)).toBeCloseTo(128 - (4 - Math.PI) * 4, -0.5)
  })

  test("polygons fill by winding or by parity, with exact shares across", () => {
    const outer = [
      { x: 2.5, y: 2 },
      { x: 32.25, y: 2 },
      { x: 32.25, y: 22 },
      { x: 2.5, y: 22 },
    ]
    const inner = [
      { x: 10, y: 8 },
      { x: 20, y: 8 },
      { x: 20, y: 16 },
      { x: 10, y: 16 },
    ]
    const nonzero = emptyCoverage({ width: 40, height: 30 })
    polygons(nonzero, [outer, inner], "nonzero")
    expect(sum(nonzero)).toBeCloseTo(29.75 * 20, 2)
    expect(at(nonzero, 2, 10)).toBeCloseTo(0.5)
    const evenodd = emptyCoverage({ width: 40, height: 30 })
    polygons(evenodd, [outer, inner], "evenodd")
    expect(sum(evenodd)).toBeCloseTo(29.75 * 20 - 80, 2)
    expect(at(evenodd, 15, 12)).toBe(0)
  })

  test("the grid puts the box's top left at 0, 0 and swaps left and right when mirrored", () => {
    const grid = gridFor({ minX: 0, minY: 0, maxX: 10, maxY: 5 }, 10, false)
    expect([grid.width, grid.height]).toEqual([100, 50])
    expect(toPixel(grid, { x: 0, y: 5 })).toEqual({ x: 0, y: 0 })
    const mirrored = gridFor({ minX: 0, minY: 0, maxX: 10, maxY: 5 }, 10, true)
    expect(toPixel(mirrored, { x: 0, y: 0 })).toEqual({ x: 100, y: 50 })
  })
})
