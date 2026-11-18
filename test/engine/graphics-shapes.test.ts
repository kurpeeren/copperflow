import { describe, expect, it } from "vitest"
import { cleanRing, counted, finish, signedArea, wound } from "../../src/engine/graphics/shapes.js"
import { fillsFromRings } from "../../src/engine/graphics/rings.js"
import { parseTransform, apply } from "../../src/engine/graphics/transform.js"
import { svgArc } from "../../src/engine/graphics/curves.js"

const square = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
]

describe("shapes helpers", () => {
  it("measures signed area positive counter-clockwise", () => {
    expect(signedArea(square(0, 0, 2))).toBe(4)
    expect(signedArea(wound(square(0, 0, 2), false))).toBe(-4)
  })
  it("drops repeated neighbours and the closing copy, without changing its input", () => {
    const input = [...square(0, 0, 1), { x: 0, y: 0 }]
    const copy = JSON.stringify(input)
    expect(cleanRing([input[0]!, ...input])).toHaveLength(4)
    expect(JSON.stringify(input)).toBe(copy)
  })
  it("moves the bounds to start at (0, 0)", () => {
    const r = finish([{ outer: square(5, -3, 2), holes: [] }], [{ points: [{ x: 10, y: 10 }], width: 0, closed: false }], [])
    expect(r.width).toBe(5)
    expect(r.height).toBe(13)
    expect(r.fills[0]!.outer[0]).toEqual({ x: 0, y: 0 })
  })
  it("says counts in words", () => {
    expect(counted(1, "text element")).toBe("1 text element")
    expect(counted(2, "text element")).toBe("2 text elements")
  })
})

describe("rings by fill rule", () => {
  it("nests three squares under evenodd into two fills", () => {
    const fills = fillsFromRings([square(0, 0, 10), square(2, 2, 6), square(4, 4, 2)], "evenodd")
    expect(fills).toHaveLength(2)
    expect(fills.find((f) => signedArea(f.outer) === 100)!.holes).toHaveLength(1)
  })
  it("fills a same-direction inner ring under nonzero", () => {
    expect(fillsFromRings([square(0, 0, 10), square(2, 2, 6)], "nonzero")).toEqual([expect.objectContaining({ holes: [] })])
  })
  it("drops rings of fewer than 3 points", () => {
    expect(fillsFromRings([[{ x: 0, y: 0 }, { x: 1, y: 1 }]], "nonzero")).toHaveLength(0)
  })
})

describe("transforms and arcs", () => {
  it("applies the list outermost first", () => {
    expect(apply(parseTransform("translate(10) scale(2)"), { x: 1, y: 1 })).toEqual({ x: 12, y: 2 })
  })
  it("refuses an unknown transform", () => {
    expect(() => parseTransform("spin(3)")).toThrow()
  })
  it("passes a quarter arc through the known point at 45 degrees", () => {
    const pts = svgArc({ x: 10, y: 0 }, 10, 10, 0, false, true, { x: 0, y: 10 }, 0.001)
    const mid = { x: 10 * Math.SQRT1_2, y: 10 * Math.SQRT1_2 }
    expect(Math.min(...pts.map((p) => Math.hypot(p.x - mid.x, p.y - mid.y)))).toBeLessThan(0.05)
    expect(pts.at(-1)).toEqual({ x: 0, y: 10 })
  })
})
