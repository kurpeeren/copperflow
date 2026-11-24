import { describe, expect, test } from "vitest"
import {
  alongStrip,
  gridAround,
  gridOutline,
  holeKey,
  holeName,
  holeOfKey,
  holePoint,
  holesFor,
  inGrid,
  nearestHole,
  neighbours,
  parseHole,
  rowIndex,
  rowName,
  sameStrip,
  stripName,
} from "../../../src/engine/proto/grid.js"

describe("hole names", () => {
  test("rows are letters from the top, past Z they take two", () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(rowName)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA", "ZZ", "AAA"])
  })

  test("a row name reads back to its index", () => {
    for (const row of [0, 7, 25, 26, 99, 701, 702]) expect(rowIndex(rowName(row))).toBe(row)
    expect(rowIndex("a")).toBeUndefined()
    expect(rowIndex("")).toBeUndefined()
  })

  test("C7 is row C, column 7", () => {
    expect(holeName({ col: 6, row: 2 })).toBe("C7")
    expect(parseHole("C7")).toEqual({ col: 6, row: 2 })
    expect(parseHole("AA12")).toEqual({ col: 11, row: 26 })
  })

  test("names that are not holes", () => {
    for (const name of ["C0", "7C", "C", "c7", "C07", "C-1", ""]) expect(parseHole(name)).toBeUndefined()
  })
})

describe("the grid", () => {
  const grid = gridAround("perfboard", 10, 6, { x: 0, y: 0 })

  test("is centred on the board, A1 at the top left", () => {
    expect(grid.first.x).toBeCloseTo(-4.5 * 2.54)
    expect(grid.first.y).toBeCloseTo(2.5 * 2.54)
    const last = holePoint(grid, { col: 9, row: 5 })
    expect(last.x).toBeCloseTo(4.5 * 2.54)
    expect(last.y).toBeCloseTo(-2.5 * 2.54)
  })

  test("its outline lies half a pitch outside the outer holes", () => {
    const outline = gridOutline(grid)
    const xs = outline.map((p) => p.x)
    const ys = outline.map((p) => p.y)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(25.4)
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(6 * 2.54)
  })

  test("finds the nearest hole and how far it is", () => {
    const at = holePoint(grid, { col: 3, row: 2 })
    const near = nearestHole(grid, { x: at.x + 0.3, y: at.y - 0.4 })
    expect(near.hole).toEqual({ col: 3, row: 2 })
    expect(near.distance).toBeCloseTo(0.5)
  })

  test("keeps the nearest hole inside the grid", () => {
    expect(nearestHole(grid, { x: -100, y: 100 }).hole).toEqual({ col: 0, row: 0 })
    expect(nearestHole(grid, { x: 100, y: -100 }).hole).toEqual({ col: 9, row: 5 })
  })

  test("knows which holes are on it", () => {
    expect(inGrid(grid, { col: 0, row: 0 })).toBe(true)
    expect(inGrid(grid, { col: 10, row: 0 })).toBe(false)
    expect(inGrid(grid, { col: 0, row: -1 })).toBe(false)
    expect(inGrid(grid, { col: 0.5, row: 0 })).toBe(false)
  })

  test("a key and back", () => {
    expect(holeOfKey(grid, holeKey(grid, { col: 7, row: 4 }))).toEqual({ col: 7, row: 4 })
  })

  test("counts the holes a length needs", () => {
    expect(holesFor(25.4)).toBe(10)
    expect(holesFor(25.5)).toBe(11)
    expect(holesFor(0.1)).toBe(2)
  })

  test("neighbours are one step across or down", () => {
    expect(neighbours({ col: 1, row: 1 }, { col: 2, row: 1 })).toBe(true)
    expect(neighbours({ col: 1, row: 1 }, { col: 1, row: 0 })).toBe(true)
    expect(neighbours({ col: 1, row: 1 }, { col: 2, row: 2 })).toBe(false)
    expect(neighbours({ col: 1, row: 1 }, { col: 3, row: 1 })).toBe(false)
  })
})

describe("strips", () => {
  test("run along the rows unless turned", () => {
    const rows = gridAround("stripboard", 5, 4, { x: 0, y: 0 })
    expect(rows.strips).toBe("rows")
    expect(alongStrip(rows, { col: 1, row: 2 })).toEqual({ col: 2, row: 2 })
    expect(alongStrip(rows, { col: 4, row: 2 })).toBeUndefined()
    expect(sameStrip(rows, { col: 1, row: 2 }, { col: 2, row: 2 })).toBe(true)
    expect(sameStrip(rows, { col: 1, row: 2 }, { col: 1, row: 3 })).toBe(false)
    expect(stripName(rows, { col: 1, row: 2 })).toBe("strip C")
  })

  test("down the columns when turned", () => {
    const columns = gridAround("stripboard", 5, 4, { x: 0, y: 0 }, "columns")
    expect(alongStrip(columns, { col: 1, row: 2 })).toEqual({ col: 1, row: 3 })
    expect(alongStrip(columns, { col: 1, row: 3 })).toBeUndefined()
    expect(sameStrip(columns, { col: 1, row: 2 }, { col: 1, row: 3 })).toBe(true)
    expect(stripName(columns, { col: 1, row: 2 })).toBe("strip 2")
  })

  test("a perfboard has no strip direction", () => {
    expect(gridAround("perfboard", 5, 4, { x: 0, y: 0 }, "columns").strips).toBeUndefined()
  })
})
