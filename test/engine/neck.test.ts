// The narrowest neck of copper between the things it joins: never read wider than the copper, and at most a few cells
// narrower.
import { describe, expect, test } from "vitest"
import { narrowestNecks, unread, UNDER_READ, type Terminal } from "../../src/engine/checks/neck.js"
import type { Point } from "../../src/engine/model.js"

const box = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]
const terminal = (id: string, x: number, y: number, half = 1): Terminal => ({ id, core: [box(x - half, y - half, x + half, y + half)], spread: [] })

/** Two 10 mm squares joined by a bar `width` wide and 4 mm long. */
function dumbbell(width: number): Point[] {
  const [low, high] = [5 - width / 2, 5 + width / 2]
  return [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: low },
    { x: 14, y: low },
    { x: 14, y: 0 },
    { x: 24, y: 0 },
    { x: 24, y: 10 },
    { x: 14, y: 10 },
    { x: 14, y: high },
    { x: 10, y: high },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ]
}

/** A bar `width` wide from (0, 0) to (20, 20). */
function diagonal(width: number): Point[] {
  const n = width / 2 / Math.SQRT2
  return [
    { x: n, y: -n },
    { x: 20 + n, y: 20 - n },
    { x: 20 - n, y: 20 + n },
    { x: -n, y: n },
  ]
}

const ends = [terminal("A", 3, 5), terminal("B", 21, 5)]

describe("the narrowest neck", () => {
  test.each([0.5, 1, 2, 3.3])("of a bar %f mm wide is read no wider, and at most a few cells narrower", (width) => {
    const cell = 0.05
    const [neck] = narrowestNecks([dumbbell(width)], ends, cell)
    expect(neck?.joined).toEqual(["A", "B"])
    expect(neck?.width).toBeLessThanOrEqual(width)
    expect(neck?.width).toBeGreaterThanOrEqual(width - UNDER_READ * cell)
    expect(neck?.at?.x).toBeGreaterThan(9.5)
    expect(neck?.at?.x).toBeLessThan(14.5)
  })

  test("a slanted bar is read no wider either", () => {
    for (const width of [0.8, 1.5, 2.5]) {
      const cell = 0.05
      const [neck] = narrowestNecks([diagonal(width)], [terminal("A", 0, 0), terminal("B", 20, 20)], cell)
      expect(neck?.width).toBeLessThanOrEqual(width)
      expect(neck?.width).toBeGreaterThanOrEqual(width - UNDER_READ * cell)
    }
  })

  test("a slit narrower than a cell still cuts: the copper goes round it", () => {
    const outer = box(0, 0, 24, 10)
    const slit = box(11.97, 1, 12.03, 9.5).reverse()
    const cell = 0.1
    const [neck] = narrowestNecks([outer, slit], ends, cell)
    // Round the slit's bottom end the copper is 1 mm wide, round its top 0.5 mm: the widest path takes the bottom.
    expect(neck?.width).toBeLessThanOrEqual(1)
    expect(neck?.width).toBeGreaterThanOrEqual(1 - UNDER_READ * cell)
  })

  test("pieces that join one terminal each have no neck to measure", () => {
    expect(narrowestNecks([box(0, 0, 10, 10), box(14, 0, 24, 10)], ends, 0.1)).toEqual([])
    expect(narrowestNecks([], ends, 0.1)).toEqual([])
  })

  test("terminals that meet need no copper between them", () => {
    const [neck] = narrowestNecks([box(0, 0, 10, 10)], [terminal("A", 4, 5), terminal("B", 5, 5)], 0.1)
    expect(neck).toEqual({ width: Infinity, joined: ["A", "B"] })
  })

  test("a terminal's spread is not measured, but reaches no copper across a slit", () => {
    // A 1 mm bar from A's square; B's spread covers the bar's far half, so only the near half is measured.
    const spreadB = { ...terminal("B", 21, 5), spread: [box(12, 0, 24, 10)] }
    const [neck] = narrowestNecks([dumbbell(1)], [terminal("A", 3, 5), spreadB], 0.05)
    expect(neck?.width).toBeLessThanOrEqual(1)
    expect(neck?.at?.x).toBeLessThan(12.1)
    // Behind a slit, copper inside the spread is not the terminal's unless copper inside the spread joins it to the core:
    // both ways round the slit (1 mm at its foot, 0.5 mm at its head) are outside the spread, so they are still measured.
    const slit = box(11.97, 1, 12.03, 9.5).reverse()
    const across = { ...terminal("B", 21, 5), spread: [box(10, 2, 24, 9)] }
    const [round] = narrowestNecks([box(0, 0, 24, 10), slit], [terminal("A", 3, 5), { ...across, core: [box(13, 4, 14, 6)] }], 0.05)
    expect(round?.width).toBeLessThanOrEqual(1)
  })

  test("a neck thinner than the grid can hold leaves no copper cell: `unread` names the terminals it parts", () => {
    for (const width of [0.05, 0.1, 0.2]) {
      const necks = narrowestNecks([dumbbell(width)], ends, 0.15)
      expect(necks).toEqual([])
      expect(unread(necks, [["A", "B"]])).toEqual([["A", "B"]])
    }
    const third = narrowestNecks([dumbbell(2)], [...ends, terminal("C", 50, 50)], 0.1)
    expect(unread(third, [["A", "B", "C"]])).toEqual([["A", "B", "C"]])
    expect(unread(third, [["A", "B"], ["C"]])).toEqual([])
  })

  test("where two terminals' spreads meet, the copper is measured", () => {
    // Two 1 mm pads 5 mm apart, each spread 4 mm, joined by a 0.3 mm bar: the spreads cover the bar, but meet on it.
    const pads = [box(0, 0, 1, 1), box(6, 0, 7, 1)]
    const shape = [...pads[0]!.slice(0, 2), { x: 1, y: 0.35 }, { x: 6, y: 0.35 }, { x: 6, y: 0 }, { x: 7, y: 0 }, { x: 7, y: 1 }, { x: 6, y: 1 }, { x: 6, y: 0.65 }, { x: 1, y: 0.65 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
    const grow = (b: Point[], by: number) => box(b[0]!.x - by, b[0]!.y - by, b[2]!.x + by, b[2]!.y + by)
    const terminals = pads.map((pad, i) => ({ id: i === 0 ? "A" : "B", core: [grow(pad, -0.2)], spread: [grow(pad, 4)] }))
    const [neck] = narrowestNecks([shape], terminals, 0.02)
    expect(neck?.width).toBeLessThanOrEqual(0.3)
    expect(neck?.width).toBeGreaterThanOrEqual(0.3 - UNDER_READ * 0.02)
  })

  test("a terminal with no copper under it is left out", () => {
    const necks = narrowestNecks([dumbbell(2)], [...ends, terminal("C", 50, 50)], 0.1)
    expect(necks.map((neck) => neck.joined)).toEqual([["A", "B"]])
  })

  test("a third terminal behind a thinner neck sets the width", () => {
    const joined = [...dumbbell(2).slice(0, 5), { x: 24, y: 4.6 }, { x: 30, y: 4.6 }, { x: 30, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 5.4 }, { x: 24, y: 5.4 }, ...dumbbell(2).slice(6)]
    const [neck] = narrowestNecks([joined], [...ends, terminal("C", 35, 5)], 0.05)
    expect(neck?.joined).toEqual(["A", "B", "C"])
    expect(neck?.width).toBeLessThanOrEqual(0.8)
    expect(neck?.width).toBeGreaterThanOrEqual(0.8 - UNDER_READ * 0.05)
  })
})
