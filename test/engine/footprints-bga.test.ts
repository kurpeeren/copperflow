import { describe, expect, test } from "vitest"
import { bgaLand, bgaRowName } from "../../src/engine/footprints/bga.js"
import { padCount } from "../../src/engine/footprints/index.js"
import { courtyardHalf, expectWellFormed, footprint, pad, refused } from "./footprint-checks.js"

describe("BGA", () => {
  test("rows are lettered A to Y without I, O, Q, S, X and Z, then AA, AB, … and BA", () => {
    const first = Array.from({ length: 20 }, (_, i) => bgaRowName(i)).join("")
    expect(first).toBe("ABCDEFGHJKLMNPRTUVWY")
    expect([20, 21, 22, 39, 40, 41].map(bgaRowName)).toEqual(["AA", "AB", "AC", "AY", "BA", "BB"])
    for (let i = 0; i < 500; i++) expect(bgaRowName(i)).not.toMatch(/[IOQSXZ]/)
    expect(new Set(Array.from({ length: 500 }, (_, i) => bgaRowName(i))).size).toBe(500)
  })

  test("BGA-256 17×17 1.0: a 16×16 grid of 0.40 mm lands, A1 at the top left", () => {
    // Ball 0.50 mm at 1.0 mm pitch; a 20% smaller land: 0.50 × 0.80 = 0.40.
    const fp = footprint("bga256_17x17_p1")
    expect(fp.pads).toHaveLength(256)
    expect(pad(fp, "A1")).toMatchObject({ x: -7.5, y: 7.5, width: 0.4, height: 0.4, shape: "circle", layers: "top" })
    expect(pad(fp, "A16")).toMatchObject({ x: 7.5, y: 7.5 })
    expect(pad(fp, "T1")).toMatchObject({ x: -7.5, y: -7.5 })
    expect(pad(fp, "T16")).toMatchObject({ x: 7.5, y: -7.5 })
    expect(pad(fp, "B2")).toMatchObject({ x: -6.5, y: 6.5 })
    const rows = [...new Set(fp.pads.map((p) => p.number.replace(/\d+$/, "")))]
    expect(rows).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "R", "T"])
    // Courtyard: body 8.5 + 1.0 = 9.5.
    expect(courtyardHalf(fp)).toEqual({ x: 9.5, y: 9.5 })
    expect(fp.origin).toContain("16×16 grid")
    expectWellFormed(fp)
  })

  test("lands by pitch", () => {
    expect(bgaLand(1.27)).toEqual({ ball: 0.75, land: 0.55 })
    expect(bgaLand(1)).toEqual({ ball: 0.5, land: 0.4 })
    expect(bgaLand(0.8)).toEqual({ ball: 0.4, land: 0.3 })
    expect(bgaLand(0.65)).toEqual({ ball: 0.35, land: 0.3 })
    expect(bgaLand(0.5)).toEqual({ ball: 0.3, land: 0.25 })
    expect(bgaLand(0.4)).toEqual({ ball: 0.25, land: 0.2 })
    expect(bgaLand(0.9)).toBeUndefined()
  })

  test("_rows<R>x<C> makes a rectangular grid", () => {
    const fp = footprint("bga24_6x8_p1_rows6x4")
    expect(fp.pads).toHaveLength(24)
    expect(pad(fp, "A1")).toMatchObject({ x: -1.5, y: 2.5 })
    expect(pad(fp, "F4")).toMatchObject({ x: 1.5, y: -2.5 })
    expect(fp.name).toBe("bga24_6x8_p1_rows6x4")
    expect(footprint("bga256_17x17_p1_rows16x16").pads).toEqual(footprint("bga256_17x17_p1").pads)
    expectWellFormed(fp)
  })

  test("a grid past row Y uses double letters", () => {
    const fp = footprint("bga484_23x23_p1")
    expect(fp.pads).toHaveLength(484)
    expect(pad(fp, "AB22")).toMatchObject({ x: 10.5, y: -10.5 })
  })

  test.each(["bga256_17x17_p1", "bga64_8x8_p0.8", "bga100_6x6_p0.5", "bga49_3.5x3.5_p0.4", "bga144_19x19_p1.27"])(
    "%s: courtyard holds the pads, silkscreen clears them, the pin 1 bracket is by A1",
    (text) => {
      const fp = footprint(text)
      expectWellFormed(fp)
      const a1 = pad(fp, "A1")
      const outline = fp.silkscreen[0] ?? []
      const half = { x: Math.max(...outline.map((p) => p.x)), y: Math.max(...outline.map((p) => p.y)) }
      const bracket = fp.silkscreen[1] ?? []
      expect(bracket).toHaveLength(3)
      for (const point of bracket) expect(point.x < -half.x || point.y > half.y).toBe(true)
      const corner = bracket[1] ?? { x: 0, y: 0 }
      expect(corner.x).toBeLessThan(a1.x)
      expect(corner.y).toBeGreaterThan(a1.y)
    },
  )

  test("determinism and padCount", () => {
    expect(JSON.stringify(footprint("bga64_8x8_p0.8"))).toBe(JSON.stringify(footprint("BGA64_8mmx8mm_p0.80mm")))
    expect(padCount("bga256_17x17_p1")).toBe(256)
  })

  test("strings that are not a full grid are refused", () => {
    for (const text of [
      "bga64",
      "bga255_17x17_p1",
      "bga256_17x17",
      "bga256_17x17_p0.9",
      "bga256_14x14_p1",
      "bga24_6x8_p1_rows5x5",
      "bga24_5x5_p1_rows6x4",
      "bga256_17x17_p1_w17",
      "bga256_17x17_p1_ep2",
      "bga256x2_17x17_p1",
      "bga0_1x1_p1",
    ]) {
      refused(text)
    }
  })
})
