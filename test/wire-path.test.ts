import { describe, expect, test } from "vitest"
import { squarePath, tidyPath, wirePath } from "../studio/src/pcb/wire-path.js"

const p = (x: number, y: number) => ({ x, y })

describe("squarePath", () => {
  test("a leg off both axes goes horizontal first unless its bend says vertical", () => {
    expect(squarePath([p(0, 0), p(2, 1)])).toEqual([p(0, 0), p(2, 0), p(2, 1)])
    expect(squarePath([p(0, 0), p(2, 1)], [true])).toEqual([p(0, 0), p(0, 1), p(2, 1)])
  })

  test("each leg has its own bend", () => {
    expect(squarePath([p(0, 0), p(2, 1), p(3, 3)], [false, true])).toEqual([p(0, 0), p(2, 0), p(2, 1), p(2, 3), p(3, 3)])
  })

  test("a leg on an axis needs no elbow", () => {
    expect(squarePath([p(0, 0), p(0, 3)], [true])).toEqual([p(0, 0), p(0, 3)])
  })

  test("an empty path stays empty", () => {
    expect(squarePath([])).toEqual([])
  })
})

describe("tidyPath", () => {
  test("drops repeated points and points in the middle of a straight run", () => {
    expect(tidyPath([p(0, 0), p(1, 0), p(1, 0), p(2, 0), p(2, 1)])).toEqual([p(0, 0), p(2, 0), p(2, 1)])
    expect(tidyPath([p(0, 0), p(0, 1), p(0, 2)])).toEqual([p(0, 0), p(0, 2)])
  })

  test("keeps a turn and rounds to 4 decimals", () => {
    expect(tidyPath([p(0.00004, 0), p(1.23456, 0), p(1.23456, 2.00001)])).toEqual([p(0, 0), p(1.2346, 0), p(1.2346, 2)])
  })

  test("keeps a point where the wire doubles back only when it turns", () => {
    expect(tidyPath([p(0, 0), p(2, 0), p(1, 0)])).toEqual([p(0, 0), p(1, 0)])
  })
})

describe("wirePath", () => {
  test("squares then tidies", () => {
    expect(wirePath([p(0, 0), p(2, 0), p(2, 1)])).toEqual([p(0, 0), p(2, 0), p(2, 1)])
  })
})
