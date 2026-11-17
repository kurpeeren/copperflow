import { describe, expect, test } from "vitest"
import { ASSUMED_HEIGHT, HEIGHT_TABLE, partHeight } from "../../src/engine/solid/heights.js"

const part = (footprint: string | undefined, props: Record<string, unknown> = {}) => ({ ...(footprint === undefined ? {} : { footprint }), props })

describe("part heights", () => {
  test("a height the part gives wins, in mm or as a length", () => {
    expect(partHeight(part("soic8", { height: 3 }))).toEqual({ height: 3, source: "given", state: "given", assumed: false })
    expect(partHeight(part("soic8", { height: "2.2mm" }))).toEqual({ height: 2.2, source: "given", state: "given", assumed: false })
  })

  test("a height that is not a positive length is not used", () => {
    expect(partHeight(part("soic8", { height: 0 })).height).toBe(1.75)
    expect(partHeight(part("soic8", { height: "tall" })).height).toBe(1.75)
  })

  test("known packages take the table's height with its source", () => {
    const cases: [string, number][] = [
      ["0402", 0.55],
      ["0603", 0.9],
      ["0805", 1.45],
      ["1206", 1.8],
      ["soic8", 1.75],
      ["soic18w", 2.65],
      ["sot23", 1.12],
      ["sot23_5", 1.45],
      ["sot23_6", 1.45],
      ["qfn32_5x5_p0.5", 1],
      ["lqfp64_10x10_p0.5", 1.6],
      ["tqfp44_10x10_p0.8", 1.2],
      ["sod123", 1.35],
      ["pinrow10", 8.5],
      ["pinrow2x5", 8.5],
      ["hc49", 13.46],
      ["hc49s", 3.5],
      ["radial6.3x2.5", 11],
      ["radial10x5", 16],
    ]
    for (const [footprint, height] of cases) {
      const found = partHeight(part(footprint))
      expect(found.height, footprint).toBe(height)
      expect(found.assumed, footprint).toBe(false)
      expect(found.source, footprint).not.toBe("")
    }
  })

  test("a package the table does not know, a footprint file or no footprint gets 1 mm, assumed", () => {
    for (const footprint of ["to220", "pinrow3_p5.08mm", "parts/X/footprint.yaml", "radial7x3", undefined]) {
      expect(partHeight(part(footprint)), String(footprint)).toEqual({ height: ASSUMED_HEIGHT, source: "assumed", state: "assumed", assumed: true })
    }
    expect(ASSUMED_HEIGHT).toBe(1)
  })

  test("every row of the table names its source", () => {
    for (const row of HEIGHT_TABLE) expect(row.source.length, row.packages).toBeGreaterThan(10)
  })
})
