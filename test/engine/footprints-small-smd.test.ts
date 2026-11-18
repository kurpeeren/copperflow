import { describe, expect, test } from "vitest"
import { arrayFootprint } from "../../src/engine/footprints/array.js"
import { DUAL_FORMS, dualExposedFootprint, outlineFromMemory } from "../../src/engine/footprints/dual.js"
import { melfFootprint } from "../../src/engine/footprints/melf.js"
import { parseFootprint, type ParsedFootprint } from "../../src/engine/footprints/parse.js"
import { smallSotFootprint } from "../../src/engine/footprints/smallsot.js"
import { sodFamily, sodFootprint } from "../../src/engine/footprints/sod.js"
import { tantalumFootprint } from "../../src/engine/footprints/tantalum.js"
import { isRefusal, type Footprint, type Refusal } from "../../src/engine/footprints/types.js"
import { EPS, expectWellFormed, footprint, neighbourDistances, pad, refusedAll } from "./footprint-checks.js"

type Family = (parsed: ParsedFootprint) => Footprint | Refusal | undefined

function parsed(text: string): ParsedFootprint {
  const result = parseFootprint(text)
  if (!result) throw new Error(`${text} does not parse`)
  return result
}

/** A footprint from a family function that is not registered yet. */
function made(family: Family, text: string): Footprint {
  const result = family(parsed(text))
  if (!result || isRefusal(result)) throw new Error(`${text}: ${result ? result.refused : "declined"}`)
  return result
}

const numbers = (fp: Footprint) => fp.pads.map((p) => p.number)

describe("chips 01005 and 2220", () => {
  test("made as the other chips, two pads apart on x", () => {
    for (const code of ["01005", "2220"]) {
      const fp = footprint(code)
      expect(numbers(fp)).toEqual(["1", "2"])
      expect(pad(fp, 1).x).toBeCloseTo(-pad(fp, 2).x, 9)
      expectWellFormed(fp)
    }
    // 01005 is under 1.6 mm: Table 3-6 (toe 0.20). Z = 0.38 + 0.40 + √(0.04² + 0.1² + 0.05²) = 0.8989 → 0.90.
    const tiny = footprint("01005")
    expect(pad(tiny, 2).x + pad(tiny, 2).width / 2).toBeCloseTo(0.45, 9)
    expect(footprint("2220").pads[0]?.height).toBeGreaterThan(4.5)
  })
})

describe("SOD", () => {
  test("sod523, sod923, sod123f, sod128 through the family function; the old ones unchanged", () => {
    for (const text of ["sod523", "sod923", "sod123f", "SOD128", "sod123", "sod323"]) {
      const fp = made(sodFamily, text)
      expect(numbers(fp)).toEqual(["1", "2"])
      expect(fp.silkscreen).toHaveLength(3)
      expectWellFormed(fp)
    }
    expect(made(sodFamily, "sod123")).toEqual(sodFootprint("123"))
    expect(made(sodFamily, "sod123f").name).toBe("sod123f")
    expect(sodFamily(parsed("sod123_p1"))).toBeUndefined()
    expect(sodFamily(parsed("sod999"))).toBeUndefined()
  })

  test("SOD-523 from the cited NXP numbers, worked by hand", () => {
    // HE 1.55–1.65, T 0.15–0.25, b 0.26–0.34, D 1.25: Note 1 (Smin 1.05 ≤ 1.25) heel 0.15.
    // Z = 1.55 + 0.70 + √(0.1² + 0.1² + 0.05²) = 2.40 → 2.40; X = 0.26 + 0.06 + √(0.08² + 0.1² + 0.05²) = 0.4575 → 0.45.
    const fp = made(sodFamily, "sod523")
    expect(pad(fp, 2).x + pad(fp, 2).width / 2).toBeCloseTo(1.2, 9)
    expect(pad(fp, 2).height).toBeCloseTo(0.45, 9)
    expect(sodFootprint("523")).toBeUndefined()
    // cathode bar on the pad 2 side
    expect(fp.silkscreen[2]?.[0]?.x).toBeGreaterThan(0)
  })
})

describe("MELF", () => {
  test("minimelf and melf with their aliases", () => {
    expect(made(melfFootprint, "sod80").pads).toEqual(made(melfFootprint, "minimelf").pads)
    expect(made(melfFootprint, "DO213AA").pads).toEqual(made(melfFootprint, "minimelf").pads)
    expect(made(melfFootprint, "do213ab").pads).toEqual(made(melfFootprint, "melf").pads)
    for (const text of ["minimelf", "melf"]) {
      const fp = made(melfFootprint, text)
      expect(numbers(fp)).toEqual(["1", "2"])
      expect(fp.silkscreen.at(-1)?.[0]?.x).toBeGreaterThan(0)
      expectWellFormed(fp)
    }
    expect(made(melfFootprint, "melf").pads[0]?.height).toBeGreaterThan(made(melfFootprint, "minimelf").pads[0]?.height ?? 0)
    expect(melfFootprint(parsed("melf_p1"))).toBeUndefined()
    expect(melfFootprint(parsed("sod123"))).toBeUndefined()
  })
})

describe("small SOT", () => {
  test("pad counts, numbering counter-clockwise from the bottom left, aliases", () => {
    const cases: Record<string, number> = { sot323: 3, sot353: 5, sot363: 6, sot523: 3, sot563: 6, sot723: 3, sot143: 4 }
    for (const [text, count] of Object.entries(cases)) {
      const fp = made(smallSotFootprint, text)
      expect(fp.pads, text).toHaveLength(count)
      const first = pad(fp, 1)
      expect(first.y).toBeLessThan(0)
      expect(first.x).toBeLessThan(0)
      expect(pad(fp, count).y).toBeGreaterThan(0)
      expectWellFormed(fp)
    }
    expect(made(smallSotFootprint, "sc70").pads).toEqual(made(smallSotFootprint, "sot323").pads)
    expect(made(smallSotFootprint, "SC70_5").pads).toEqual(made(smallSotFootprint, "sot353").pads)
    expect(made(smallSotFootprint, "sc70_6").pads).toEqual(made(smallSotFootprint, "sot363").pads)
    expect(neighbourDistances(made(smallSotFootprint, "sot363"), 3).every((d) => Math.abs(d - 0.65) < EPS)).toBe(true)
    expect(neighbourDistances(made(smallSotFootprint, "sot563"), 3).every((d) => Math.abs(d - 0.5) < EPS)).toBe(true)
  })

  test("SOT-323 from the cited NXP numbers, worked by hand", () => {
    // HE 2.0–2.2, Lp 0.15–0.45, bp 0.3–0.4, E 1.35; Table 3-2, Note 1 (Smin 1.1 ≤ 1.35): heel 0.15.
    // Z = 2.70 + 0.2291 → 2.95; Smax' = 1.90 − (0.80 − 0.4690)/2 = 1.7345; G = 1.7345 − 0.30 − 0.2291 → 1.20;
    // X = 0.36 + 0.15 → 0.50. Pads 0.875 long, centres ±1.0375.
    const fp = made(smallSotFootprint, "sot323")
    expect(pad(fp, 1)).toMatchObject({ x: -0.65, width: 0.5 })
    expect(pad(fp, 1).y).toBeCloseTo(-1.0375, 9)
    expect(pad(fp, 1).height).toBeCloseTo(0.875, 9)
    expect(pad(fp, 3)).toMatchObject({ x: 0 })
  })

  test("SOT-143: pin 1 is the wide one", () => {
    const fp = made(smallSotFootprint, "sot143")
    expect(pad(fp, 1).width).toBeGreaterThan(pad(fp, 2).width)
    expect(pad(fp, 2).width).toBeCloseTo(pad(fp, 3).width, 9)
  })

  test("sot23_8 through the registered SOT family", () => {
    const fp = footprint("sot23_8")
    expect(fp.pads).toHaveLength(8)
    expect(pad(fp, 1).x).toBeCloseTo(-0.975, 9)
    expect(pad(fp, 5).x).toBeCloseTo(0.975, 9)
    expect(pad(fp, 5).y).toBeGreaterThan(0)
    expectWellFormed(fp)
  })

  test("other strings are declined", () => {
    expect(smallSotFootprint(parsed("sot23"))).toBeUndefined()
    expect(smallSotFootprint(parsed("sot323_p1"))).toBeUndefined()
    expect(smallSotFootprint(parsed("sc70_7"))).toBeUndefined()
  })
})

describe("moulded tantalum", () => {
  test("cases by letter and by size, plus at pad 1", () => {
    const pairs = [
      ["tant_a", "tant3216"],
      ["tant_b", "tant3528"],
      ["tant_c", "tant6032"],
      ["tant_d", "tant7343"],
    ]
    for (const [letter, size] of pairs) {
      const a = made(tantalumFootprint, letter as string)
      expect(a.pads).toEqual(made(tantalumFootprint, size as string).pads)
      expect(numbers(a)).toEqual(["1", "2"])
      expect(pad(a, 1).x).toBeLessThan(0)
      expectWellFormed(a)
    }
    expect(made(tantalumFootprint, "TANT_E").pads).toEqual(made(tantalumFootprint, "tant_d").pads)
    expectWellFormed(made(tantalumFootprint, "tant_e"))
    // the "+": a vertical stroke above pad 1
    const fp = made(tantalumFootprint, "tant_a")
    const stroke = fp.silkscreen.at(-1) ?? []
    expect(stroke[0]?.x).toBeCloseTo(pad(fp, 1).x, 9)
    expect(stroke[0]?.y ?? 0).toBeGreaterThan(pad(fp, 1).height / 2)
  })

  test("KEMET T491 Table 2 level B lands: length L, width W, gap S", () => {
    // [text, L, W, S]; the pad centres sit (S + L)/2 from the middle.
    const lands: [string, number, number, number][] = [
      ["tant_a", 1.8, 1.23, 0.82],
      ["tant_b", 1.8, 2.23, 1.12],
      ["tant_c", 2.37, 2.23, 2.57],
      ["tant_d", 2.37, 2.43, 3.87],
      ["tant_e", 2.37, 2.43, 3.87],
    ]
    for (const [text, length, width, gap] of lands) {
      const fp = made(tantalumFootprint, text)
      expect(pad(fp, 1).width, text).toBeCloseTo(length, 9)
      expect(pad(fp, 1).height, text).toBeCloseTo(width, 9)
      expect(pad(fp, 2).x, text).toBeCloseTo((gap + length) / 2, 9)
      expect(pad(fp, 2).x - pad(fp, 2).width / 2 - (pad(fp, 1).x + pad(fp, 1).width / 2), text).toBeCloseTo(gap, 9)
    }
  })

  test("refusals", () => {
    const tant = (text: string) => tantalumFootprint(parsed(text))
    expect(tant("tant")).toEqual({ refused: "a tantalum capacitor is tant_a … tant_e or tant3216, tant3528, tant6032, tant7343" })
    expect(tant("tant_f")).toEqual({ refused: "a tantalum capacitor is tant_a … tant_e or tant3216, tant3528, tant6032, tant7343" })
    expect(tant("tant1234")).toEqual({ refused: "the sizes are tant_a … tant_e or tant3216, tant3528, tant6032, tant7343" })
    expect(tant("radial5x2")).toBeUndefined()
  })
})

describe("MSOP and QSOP", () => {
  test("pads, pitch and the forms list", () => {
    const cases: Record<string, [number, number]> = { msop8: [8, 0.65], msop10: [10, 0.5], qsop16: [16, 0.635], qsop20: [20, 0.635], qsop24: [24, 0.635], qsop28: [28, 0.635] }
    for (const [text, [count, pitch]] of Object.entries(cases)) {
      const fp = footprint(text)
      expect(fp.pads, text).toHaveLength(count)
      expect(neighbourDistances(fp, count / 2).every((d) => Math.abs(d - pitch) < EPS), text).toBe(true)
      expect(pad(fp, 1).x).toBeLessThan(0)
      expect(pad(fp, 1).y).toBeGreaterThan(0)
      expectWellFormed(fp)
    }
    expect(DUAL_FORMS).toContainEqual({ form: "msop<N>", pins: [8] })
    expect(DUAL_FORMS).toContainEqual({ form: "msop<N>", pins: [10] })
    expect(DUAL_FORMS).toContainEqual({ form: "qsop<N>", pins: [16, 20, 24, 28] })
    expect(outlineFromMemory("msop8")).toBe(false)
    expect(outlineFromMemory("msop10")).toBe(true)
    expect(outlineFromMemory("qsop16")).toBe(true)
  })

  test("MSOP-8 from the cited Diodes numbers, worked by hand", () => {
    // E 4.70–5.10, L 0.40–0.80, b 0.22–0.38, E1 3.10; Note 1 (Smin 3.10 ≤ 3.10): heel 0.15.
    // Z = 5.40 + 0.4153 → 5.80; G = 4.0464 − 0.30 − 0.4153 → 3.35; X = 0.28 + 0.1952 → 0.50.
    const fp = footprint("msop8")
    expect(pad(fp, 1).width).toBeCloseTo(1.225, 9)
    expect(pad(fp, 1).height).toBeCloseTo(0.5, 9)
    expect(pad(fp, 1).x).toBeCloseTo(-2.2875, 9)
  })
})

/** Refusal checks for the exposed-pad family, which is not registered yet. */
function refusedEp(cases: Readonly<Record<string, string | undefined>>): void {
  for (const [text, reason] of Object.entries(cases)) {
    expect(dualExposedFootprint(parsed(text)), text).toEqual(reason === undefined ? undefined : { refused: reason })
  }
}

describe("dual packages with an exposed pad", () => {
  test("the pad is numbered pins + 1 and sits at the centre", () => {
    const cases: Record<string, number> = { "soic8_ep2.3x2.3": 8, "msop8_ep1.7x1.9": 8, "msop10_ep1.7x1.9": 10, "tssop20_ep3x4.2": 20, "TSSOP16_ep2.5x3": 16 }
    for (const [text, pins] of Object.entries(cases)) {
      const fp = made(dualExposedFootprint, text)
      expect(fp.pads, text).toHaveLength(pins + 1)
      expect(pad(fp, pins + 1)).toMatchObject({ x: 0, y: 0 })
      expectWellFormed(fp)
    }
    const soic = made(dualExposedFootprint, "soic8_ep2.3x2.4")
    expect(pad(soic, 9)).toMatchObject({ width: 2.3, height: 2.4 })
    expect(soic.name).toBe("soic8_ep2.3x2.4")
    expect(soic.pads.slice(0, 8)).toEqual(footprint("soic8").pads)
    expect(dualExposedFootprint(parsed("soic8"))).toBeUndefined()
  })

  test("a bare _ep, a pad that touches the pins, and packages without one", () => {
    const reason =
      "_ep needs the exposed pad's size, such as _ep2.3x2.3, because it differs from part to part for this package; take it from the part's drawing"
    refusedEp({
      soic8_ep: reason,
      msop10_ep: reason,
      tssop14_ep: reason,
      soic8_ep5x5: "the exposed pad would touch the pins",
      msop8_ep0x1: "the exposed pad needs a size above 0",
      soic14_ep2x2: undefined,
      qsop16_ep2x2: undefined,
    })
    // registered: the generator gives the same refusal, and makes the strings that carry a size
    refusedAll({ tssop20_ep: reason, soic8_ep: reason, msop8_ep5x5: "the exposed pad would touch the pins", soic14_ep2x2: null, qsop16_ep2x2: null })
    for (const text of ["soic8_ep2.3x2.3", "msop8_ep1.7x1.9", "msop10_ep1.7x1.9", "tssop20_ep3x4.2"]) {
      expect(footprint(text).pads, text).toHaveLength(Number(/\d+/.exec(text)?.[0]) + 1)
    }
  })
})

describe("resistor arrays", () => {
  test("eight or four pads, counter-clockwise from the bottom left", () => {
    const cases: Record<string, [number, number]> = { array4x0603: [8, 0.8], array4x0402: [8, 0.5], array2x0402: [4, 0.65] }
    for (const [text, [count, pitch]] of Object.entries(cases)) {
      const fp = made(arrayFootprint, text)
      expect(fp.pads, text).toHaveLength(count)
      expect(numbers(fp)).toEqual(Array.from({ length: count }, (_, i) => String(i + 1)))
      expect(pad(fp, 1).x).toBeLessThan(0)
      expect(pad(fp, 1).y).toBeLessThan(0)
      expect(pad(fp, count / 2).x).toBeGreaterThan(0)
      expect(pad(fp, count / 2 + 1).x).toBeCloseTo(pad(fp, count / 2).x, 9)
      expect(pad(fp, count / 2 + 1).y).toBeGreaterThan(0)
      expect(neighbourDistances(fp, count / 2).every((d) => Math.abs(d - pitch) < EPS), text).toBe(true)
      expectWellFormed(fp)
    }
    expect(arrayFootprint(parsed("array3x0603"))).toBeUndefined()
    expect(arrayFootprint(parsed("array4x0603_p1"))).toBeUndefined()
  })
})
