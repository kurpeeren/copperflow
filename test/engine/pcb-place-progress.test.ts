import { describe, expect, test } from "vitest"
import { buildDesign } from "../../src/engine/design.js"
import { placeBoard, type PlaceProgress } from "../../src/engine/pcb-place/index.js"
import { canUnplaced, CAN_MAIN } from "../helpers/place-fixtures.js"

describe("placeBoard progress", () => {
  test("tells each part of the constructive pass, then the refinement, and the result is the same without it", () => {
    const design = buildDesign(canUnplaced(), CAN_MAIN)
    const seen: PlaceProgress[] = []
    const told = placeBoard(design, { onProgress: (progress) => seen.push(progress) })
    const quiet = placeBoard(design)
    expect([...told.positions]).toEqual([...quiet.positions])
    const construct = seen.filter((p) => p.stage === "construct")
    const parts = told.positions.size + told.unplaced.length
    expect(construct.map((p) => p.done)).toEqual(Array.from({ length: parts }, (_, i) => i + 1))
    expect(construct.every((p) => p.total === parts)).toBe(true)
    const refine = seen.filter((p) => p.stage === "refine")
    expect(refine.length).toBeGreaterThan(0)
    expect(refine.at(-1)?.done).toBe(refine.at(-1)?.total)
    expect(seen.findIndex((p) => p.stage === "refine")).toBeGreaterThan(seen.findLastIndex((p) => p.stage === "construct"))
  })

  test("a throw from the callback stops the placement", () => {
    const design = buildDesign(canUnplaced(), CAN_MAIN)
    expect(() =>
      placeBoard(design, {
        onProgress: () => {
          throw new Error("stop")
        },
      }),
    ).toThrow("stop")
  })
})
