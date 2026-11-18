import { describe, expect, test } from "vitest"
import { dpakFootprint } from "../../src/engine/footprints/dpak.js"
import { generateFootprint } from "../../src/engine/footprints/index.js"
import { parseFootprint } from "../../src/engine/footprints/parse.js"
import { plccFootprint } from "../../src/engine/footprints/plcc.js"
import { smdipFootprint } from "../../src/engine/footprints/smdip.js"
import { TO92_INLINE_REFUSAL, to92InlineFootprint } from "../../src/engine/footprints/to92inline.js"
import { DEFAULT_CLASS, PROFILES } from "../../src/engine/rules/profiles.js"
import { toPowerFootprint } from "../../src/engine/footprints/topower.js"
import { isRefusal, type Footprint, type Refusal } from "../../src/engine/footprints/types.js"
import { expectWellFormed, neighbourDistances, pad } from "./footprint-checks.js"

// These families are not yet in index.ts's FAMILIES; the tests try them directly.
const NEW_FAMILIES = [dpakFootprint, toPowerFootprint, to92InlineFootprint, plccFootprint, smdipFootprint]

function attempt(text: string): Footprint | Refusal | undefined {
  const parsed = parseFootprint(text)
  if (!parsed) return undefined
  for (const family of NEW_FAMILIES) {
    const result = family(parsed)
    if (result) return result
  }
  return undefined
}

function make(text: string): Footprint {
  const result = attempt(text)
  if (!result || isRefusal(result)) throw new Error(`${text}: ${result ? result.refused : "not made"}`)
  return result
}

const numbers = (fp: Footprint) => fp.pads.map((p) => p.number)
const allNear = (values: number[], expected: number) => values.every((d) => Math.abs(d - expected) < 1e-9)

describe("DPAK and D2PAK", () => {
  test("dpak: leads 1 and 3 at ±2.29 and tab 2, worked from onsemi 369C", () => {
    // H 9.40–10.41, L 1.40–1.78, b 0.63–0.89, D 5.97–6.22; Note 1 applies (Smin 5.84 ≤ 6.22): heel 0.15.
    // Z = 10.10 + √(1.01² + 0.1² + 0.05²) = 11.116 → 11.10; Smax' = 7.297, G = 7.297 − 0.30 − 1.016 = 5.981 → 6.00
    // Lead pad (11.10 − 6.00)/2 = 2.55 long, centre −4.275; X = 0.69 + 0.283 = 0.973 → 0.95.
    // Tab: outer edge 5.55, soldered length 1.27 + 3.93 = 5.20 plus 0.35 → inner edge 0; X = 4.63 + 0.897 → 5.55.
    const fp = make("dpak")
    expect(numbers(fp)).toEqual(["1", "3", "2"])
    expect(pad(fp, 1)).toMatchObject({ x: -2.29, y: -4.275, width: 0.95, height: 2.55 })
    expect(pad(fp, 3)).toMatchObject({ x: 2.29, y: -4.275 })
    expect(pad(fp, 2)).toMatchObject({ x: 0, y: 2.775, width: 5.55, height: 5.55 })
    expectWellFormed(fp)
    expect(make("TO252").pads).toEqual(fp.pads)
  })

  test("d2pak, d2pak_5, d2pak_7 and their TO-263 names", () => {
    const three = make("d2pak")
    expect(numbers(three)).toEqual(["1", "3", "2"])
    expect(pad(three, 2).y).toBeGreaterThan(0)
    expect(pad(three, 3).x - pad(three, 1).x).toBeCloseTo(5.08, 9)
    expect(make("to263").pads).toEqual(three.pads)
    const five = make("d2pak_5")
    expect(numbers(five)).toEqual(["1", "2", "3", "4", "5", "6"])
    expect(allNear(neighbourDistances({ ...five, pads: five.pads.slice(0, 5) }, 5), 1.7)).toBe(true)
    expect(make("to263_5").pads).toEqual(five.pads)
    const seven = make("d2pak_7")
    expect(numbers(seven)).toHaveLength(8)
    expect(pad(seven, 8).x).toBe(0)
    expect(pad(seven, 2).x - pad(seven, 1).x).toBeCloseTo(1.27, 9)
    expect(make("to263_7").pads).toEqual(seven.pads)
    for (const fp of [three, five, seven]) {
      expectWellFormed(fp)
      expect((fp.pads[fp.pads.length - 1] as Footprint["pads"][number]).y).toBeGreaterThan(0)
    }
  })

  test("near misses are refused", () => {
    expect(attempt("d2pak_4")).toEqual({ refused: "a D2PAK has 3 (no variant), 5 or 7 leads" })
    expect(attempt("to263_3")).toEqual({ refused: "a D2PAK has 3 (no variant), 5 or 7 leads" })
    expect(attempt("dpak_5")).toEqual({ refused: "a DPAK takes no variant or parameters" })
    expect(attempt("d3pak")).toBeUndefined()
  })
})

describe("through-hole power packages", () => {
  test("to247: three leads 5.45 apart, pad 1 square", () => {
    // b 1.17–1.35, c 0.51–0.71: diagonal 1.525 + 0.2 → 1.75 hole, land 1.75 + 0.1 + 0.5 = 2.35.
    const fp = make("to247")
    expect(numbers(fp)).toEqual(["1", "2", "3"])
    expect(pad(fp, 1)).toMatchObject({ x: -5.45, y: 0, shape: "rect", width: 2.35, drill: { width: 1.75, height: 1.75 } })
    expect(pad(fp, 3).shape).toBe("circle")
    expectWellFormed(fp)
  })

  test("to126, to220_2 and to220_5", () => {
    const to126 = make("to126")
    expect(allNear(neighbourDistances(to126, 3), 2.29)).toBe(true)
    const two = make("to220_2")
    expect(numbers(two)).toEqual(["1", "2"])
    expect(pad(two, 2).x - pad(two, 1).x).toBeCloseTo(5.08, 9)
    const five = make("to220_5")
    expect(numbers(five)).toEqual(["1", "2", "3", "4", "5"])
    expect(allNear(neighbourDistances(five, 5), 1.7)).toBe(true)
    for (const fp of [to126, two, five]) expectWellFormed(fp)
  })

  test("to220 and to92 stay as they are; near misses refused", () => {
    expect(generateFootprint("to220")).toMatchObject({ name: "to220" })
    expect(attempt("to220")).toBeUndefined()
    expect(attempt("to92")).toBeUndefined()
    expect(attempt("to220_3")).toEqual({ refused: "TO-220 comes as to220 (3 leads), to220_2 or to220_5" })
    expect(attempt("to247_2")).toEqual({ refused: "TO-247 has three leads and takes no variant" })
  })

  test("to92_inline is refused: no lands meet the rules at 1.27 mm", () => {
    expect(attempt("to92_inline")).toEqual({ refused: TO92_INLINE_REFUSAL })
    expect(TO92_INLINE_REFUSAL).toContain("use to92")
    expect(attempt("to92_straight")).toBeUndefined()
  })
})

describe("through-hole lands meet both shipped profiles", () => {
  const stricter = {
    ring: Math.max(...Object.values(PROFILES).map((p) => p.minAnnularRing)),
    holeToHole: Math.max(...Object.values(PROFILES).map((p) => p.minHoleToHole)),
    clearance: Math.max(DEFAULT_CLASS.clearance, ...Object.values(PROFILES).map((p) => p.minClearance)),
  }
  const parts: Record<string, Footprint> = {
    to220: generateFootprint("to220") as Footprint,
    to220_2: make("to220_2"),
    to220_5: make("to220_5"),
    to247: make("to247"),
    to126: make("to126"),
  }
  for (const [name, fp] of Object.entries(parts)) {
    test(`${name}: ring, hole to hole and land to land`, () => {
      const pads = [...fp.pads].sort((a, b) => a.x - b.x)
      for (const p of pads) {
        const drill = p.drill?.width ?? 0
        expect((Math.min(p.width, p.height) - drill) / 2).toBeGreaterThanOrEqual(stricter.ring - 1e-9)
      }
      for (let i = 1; i < pads.length; i++) {
        const [a, b] = [pads[i - 1], pads[i]] as [Footprint["pads"][number], Footprint["pads"][number]]
        const centres = b.x - a.x
        expect(centres - ((a.drill?.width ?? 0) + (b.drill?.width ?? 0)) / 2).toBeGreaterThanOrEqual(stricter.holeToHole - 1e-9)
        expect(centres - (a.width + b.width) / 2).toBeGreaterThanOrEqual(stricter.clearance - 1e-9)
      }
    })
  }

  test("to220_5: 1.10 holes, 1.46 × 2.00 ovals; to247 outline Amax deep", () => {
    expect(pad(parts.to220_5 as Footprint, 2)).toMatchObject({ shape: "oval", width: 1.46, height: 2, drill: { width: 1.1, height: 1.1 } })
    const ys = (parts.to247 as Footprint).fabrication[0]?.map((p) => p.y) ?? []
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(4.82, 9)
  })
})

describe("PLCC", () => {
  test("plcc44: pad 1 in the middle of the top side, counter-clockwise", () => {
    // D 17.40–17.65, contact 1.00–1.50, toe 0.35, heel 0: Z = 18.10 + 0.274 = 18.374 → 18.35,
    // Smax' = 15.40, G = 15.40 − 0.758 = 14.642 → 14.65; pad 1.85 long, centre 8.25.
    const fp = make("plcc44")
    expect(fp.pads).toHaveLength(44)
    expect(pad(fp, 1)).toMatchObject({ x: 0, y: 8.25, height: 1.85 })
    expect(pad(fp, 2).x).toBeCloseTo(-1.27, 9)
    expect(pad(fp, 44).x).toBeCloseTo(1.27, 9)
    expect(pad(fp, 7)).toMatchObject({ x: -8.25, y: 6.35 })
    expect(pad(fp, 23)).toMatchObject({ x: 0, y: -8.25 })
    expect(pad(fp, 34)).toMatchObject({ x: 8.25, y: 0 })
    expectWellFormed(fp)
  })

  test("all sizes, and the rectangular plcc32", () => {
    for (const n of [20, 28, 32, 44, 52, 68, 84]) {
      const fp = make(`plcc${n}`)
      expect(new Set(numbers(fp)).size).toBe(n)
      expect(pad(fp, 1).x).toBe(0)
      expectWellFormed(fp)
    }
    const fp = make("plcc32")
    // 7 leads on the top and bottom, 9 on the sides; pins 1–4 on the top, 5–13 down the left.
    expect(fp.pads.filter((p) => p.y === pad(fp, 1).y)).toHaveLength(7)
    expect(pad(fp, 5).x).toBeLessThan(0)
    expect(pad(fp, 13).x).toBe(pad(fp, 5).x)
    expect(pad(fp, 14).y).toBeLessThan(0)
  })

  test("near misses are refused", () => {
    expect(attempt("plcc30")).toEqual({ refused: "a PLCC has 20, 28, 32, 44, 52, 68 or 84 pins" })
    expect(attempt("plcc44_p1.27mm")).toEqual({ refused: "a PLCC takes no variant or parameters" })
  })
})

describe("surface-mount DIP", () => {
  test("smdip4/6/8/16: DIP numbering at 2.54", () => {
    for (const n of [4, 6, 8, 16]) {
      const fp = make(`smdip${n}`)
      expect(fp.pads).toHaveLength(n)
      expect(allNear(neighbourDistances(fp, n / 2), 2.54)).toBe(true)
      expect(pad(fp, 1).x).toBeLessThan(0)
      expect(pad(fp, 1).y).toBeGreaterThan(0)
      expect(pad(fp, n).x).toBeGreaterThan(0)
      expect(pad(fp, n).y).toBe(pad(fp, 1).y)
      expectWellFormed(fp)
    }
  })

  test("smdip8 pads, worked by hand", () => {
    // Span 9.40–10.16, foot 0.76–1.27, width 0.40–0.60, body 6.35–6.60; Smin 6.86 > 6.60, no Note 1.
    // Z = 10.10 + √(0.76² + 0.0125) = 10.868 → 10.85
    // Smax' = 8.64 − (1.78 − √(0.5776 + 2·0.2601))/2 = 8.274; G = 8.274 − 0.70 − 0.768 = 6.806 → 6.80
    // Pad 2.025 long, centre ±4.4125; X = 0.46 + √(0.04 + 0.0125) = 0.689 → 0.70.
    const fp = make("smdip8")
    expect(pad(fp, 1)).toMatchObject({ x: -4.4125, width: 2.025, height: 0.7 })
  })

  test("near misses are refused", () => {
    expect(attempt("smdip10")).toEqual({ refused: "a surface-mount DIP has 4, 6, 8 or 16 pins" })
    expect(attempt("smdip8_w7.62mm")).toEqual({ refused: "a surface-mount DIP takes no variant or parameters" })
  })
})
