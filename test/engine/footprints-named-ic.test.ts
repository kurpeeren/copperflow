import { describe, expect, test } from "vitest"
import { generateFootprint, padCount } from "../../src/engine/footprints/index.js"
import { EPS, courtyardHalf, expectWellFormed, footprint, neighbourDistances, pad, refusedAll } from "./footprint-checks.js"

/** Pad size along its lead and across it, and the distance between the centres of two opposite pads. */
function expectRow(text: string, first: number, opposite: number, along: "x" | "y", expected: { length: number; width: number; centres: number }) {
  const fp = footprint(text)
  const a = pad(fp, first)
  const b = pad(fp, opposite)
  expect(along === "x" ? a.width : a.height).toBeCloseTo(expected.length, 9)
  expect(along === "x" ? a.height : a.width).toBeCloseTo(expected.width, 9)
  expect(along === "x" ? b.x - a.x : b.y - a.y).toBeCloseTo(expected.centres, 9)
}

const NAMED = [
  "qfn16_3x3_p0.5",
  "qfn32_5x5_p0.5",
  "qfn32_5x5_p0.5_ep3.1",
  "qfn24_4x4_p0.5_ep2.6",
  "qfn64_9x9_p0.5_ep7.15",
  "qfn20_3x3_p0.4",
  "qfn20_5x5_p0.65_ep3x3",
  "qfp48_7x7_p0.5",
  "lqfp64_10x10_p0.5",
  "tqfp32_7x7_p0.8",
  "lqfp144_20x20_p0.5",
  "lqfp176_24x24_p0.5",
  "tqfp100_14x14_p0.5",
  "lqfp80_12x12_p0.5",
  "lqfp48_7x7_p0.4",
  "dfn8_3x3_p0.65",
  "dfn8_3x3_p0.65_ep1.6x2.4",
  "dfn6_2x2_p0.65_ep0.7x1.4",
  "dfn10_3x3_p0.5_ep1.65x2.4",
]

describe("QFN, QFP and DFN named by body and pitch", () => {
  test("QFN-32 5×5 0.5: the cited NXP HVQFN32 numbers, pin 1 at the top of the left side", () => {
    // jedec.ts gives body 4.9–5.1, L 0.3–0.5, b 0.18–0.30 at 0.5 mm, the same as NXP SOT617-1.
    // Worked in footprints-ic.test.ts ("QFN-32 follows the cited dimensions and goals"):
    // Z 5.75, G 4.00, X 0.25 → pad 0.875 × 0.25, opposite sides 4.875 apart.
    expectRow("qfn32_5x5_p0.5", 1, 24, "x", { length: 0.875, width: 0.25, centres: 4.875 })
    const fp = footprint("qfn32_5x5_p0.5_ep3.1")
    expect(fp.pads).toHaveLength(33)
    expect(pad(fp, 1)).toMatchObject({ x: -2.4375, y: 1.75 })
    expect(pad(fp, 33)).toMatchObject({ x: 0, y: 0, width: 3.1, height: 3.1 })
    expect(fp.pads).toEqual(footprint("qfn32_ep").pads)
    expect(footprint("qfn32_5x5_p0.5").pads).toEqual(footprint("qfn32").pads)
  })

  test("LQFP-64 10×10 0.5, worked by hand", () => {
    // jedec.ts: span 12 ± 0.15 = 11.85–12.15, Lp 0.45–0.75, bp 0.17–0.27, body 9.9–10.1 (NXP SOT314-2).
    // IPC-7351B Table 3-3 (pitch ≤ 0.625): Jt 0.35, Jh 0.35, Js −0.02; Note 1 does not apply
    // (Smin = 11.85 − 1.50 = 10.35 > Amax 10.1).
    // Z = 11.85 + 0.70 + √(0.30² + 0.10² + 0.05²) = 12.55 + 0.3202 = 12.8702 → 12.85
    // Smax = 12.15 − 0.90 = 11.25, CSrms = √(0.30² + 2·0.30²) = 0.5196, Smax' = 11.25 − (0.90 − 0.5196)/2 = 11.0598
    // G = 11.0598 − 0.70 − √(0.5196² + 0.10² + 0.05²) = 10.3598 − 0.5315 = 9.8283 → 9.85
    // X = 0.17 − 0.04 + √(0.10² + 0.10² + 0.05²) = 0.13 + 0.15 = 0.28 → 0.30
    // Pad (12.85 − 9.85)/2 = 1.50 × 0.30, opposite sides (12.85 + 9.85)/2 = 11.35 apart.
    expectRow("lqfp64_10x10_p0.5", 1, 48, "x", { length: 1.5, width: 0.3, centres: 11.35 })
    const fp = footprint("lqfp64_10x10_p0.5")
    expect(fp.pads).toHaveLength(64)
    expect(pad(fp, 1)).toMatchObject({ x: -5.675, y: 3.75 })
    // Courtyard: pads reach 5.675 + 0.75 = 6.425, + 0.25 = 6.675 → up to 6.70.
    expect(courtyardHalf(fp)).toEqual({ x: 6.7, y: 6.7 })
    expect(fp.pads).toEqual(footprint("qfp64").pads)
  })

  test("the cited LQFPs come out again from body and pitch", () => {
    expect(footprint("qfp48_7x7_p0.5").pads).toEqual(footprint("qfp48").pads)
    expect(footprint("lqfp32_7x7_p0.8").pads).toEqual(footprint("qfp32").pads)
    expect(footprint("lqfp100_14x14_p0.5").pads).toEqual(footprint("qfp100").pads)
  })

  test("lqfp and tqfp are qfp", () => {
    expect(footprint("tqfp48_7x7_p0.5").pads).toEqual(footprint("qfp48_7x7_p0.5").pads)
    expect(footprint("lqfp48_7x7_p0.5").pads).toEqual(footprint("qfp48_7x7_p0.5").pads)
    expect(footprint("TQFP48_7x7_p0.5mm").name).toBe("tqfp48_7x7_p0.5")
    expect(footprint("lqfp64").pads).toEqual(footprint("qfp64").pads)
    expect(footprint("tqfp32_p0.8").pads).toEqual(footprint("qfp32").pads)
  })

  test("DFN-8 3×3 0.65, worked by hand", () => {
    // jedec.ts: body 2.9–3.1 (the span), L 0.3–0.5, b 0.25–0.35 at 0.65 mm. Table 3-15 goals.
    // Z = 2.90 + 0.60 + √(0.20² + 0.10² + 0.05²) = 3.50 + 0.2291 = 3.7291 → 3.75
    // Smax = 3.10 − 0.60 = 2.50, CSrms 0.3464, Smax' = 2.50 − (0.60 − 0.3464)/2 = 2.3732
    // G = 2.3732 − 0 − √(0.3464² + 0.10² + 0.05²) = 2.3732 − 0.3640 = 2.0092 → 2.00
    // X = 0.25 − 0.08 + √(0.10² + 0.10² + 0.05²) = 0.17 + 0.15 = 0.32 → 0.30
    // Pad (3.75 − 2.00)/2 = 0.875 × 0.30, the columns (3.75 + 2.00)/2 = 2.875 apart.
    expectRow("dfn8_3x3_p0.65", 1, 8, "x", { length: 0.875, width: 0.3, centres: 2.875 })
    const fp = footprint("dfn8_3x3_p0.65_ep1.6x2.4")
    expect(pad(fp, 1)).toMatchObject({ x: -1.4375, y: 0.975 })
    expect(pad(fp, 4)).toMatchObject({ x: -1.4375, y: -0.975 })
    expect(pad(fp, 5)).toMatchObject({ x: 1.4375, y: -0.975 })
    expect(pad(fp, 9)).toMatchObject({ x: 0, y: 0, width: 1.6, height: 2.4 })
    expect(fp.origin).toBe("IPC-7351B nominal, DFN-8 3×3 mm, 0.65 mm pitch with exposed pad")
  })

  test.each([
    ["qfn20_3x3_p0.4", 5, 0.4],
    ["qfn20_5x5_p0.65_ep3x3", 5, 0.65],
    ["lqfp64_10x10_p0.5", 16, 0.5],
    ["tqfp32_7x7_p0.8", 8, 0.8],
    ["dfn10_3x3_p0.5_ep1.65x2.4", 5, 0.5],
  ] as const)("%s: neighbours %s per side, %s mm apart", (text, perSide, pitch) => {
    const fp = footprint(text)
    const signal = { ...fp, pads: fp.pads.filter((p) => Number(p.number) <= Math.round(fp.pads.length / perSide) * perSide) }
    for (const d of neighbourDistances(signal, perSide)) expect(d).toBeCloseTo(pitch, 9)
  })

  test.each(NAMED)("%s: courtyard holds the pads, silkscreen clears them, pads apart", (text) => {
    expectWellFormed(footprint(text))
  })

  test("the silkscreen carries the pin 1 mark: a line that reaches over pad 1", () => {
    for (const text of ["qfn32_5x5_p0.5", "lqfp64_10x10_p0.5", "dfn8_3x3_p0.65"]) {
      const fp = footprint(text)
      const p1 = pad(fp, 1)
      const reach = Math.min(...fp.silkscreen.flat().map((p) => p.x))
      expect(reach).toBeLessThanOrEqual(p1.x - p1.width / 2 + EPS)
    }
  })

  test("names are written the same way whatever the spelling", () => {
    expect(footprint("QFN32_5mmx5mm_p0.50mm_EP3.10").name).toBe("qfn32_5x5_p0.5_ep3.1")
    expect(footprint("dfn8_3x3_p0.65_ep1.6x2.4").name).toBe("dfn8_3x3_p0.65_ep1.6x2.4")
  })

  test("determinism: the same string gives the same footprint", () => {
    expect(JSON.stringify(footprint("lqfp64_10x10_p0.5"))).toBe(JSON.stringify(footprint("LQFP64_10x10_p0.5mm")))
  })

  test("padCount", () => {
    expect(padCount("qfn32_5x5_p0.5_ep3.1")).toBe(33)
    expect(padCount("lqfp144_20x20_p0.5")).toBe(144)
    expect(padCount("dfn8_3x3_p0.65")).toBe(8)
  })

  test("strings that are not such a package are refused", () => {
    refusedAll({
      "qfn32_5x5": "a QFN named by its body needs its pitch, such as _p0.5",
      "qfn32_5x5_p0.55": "QFN pitch must be 0.4, 0.5 or 0.65 mm",
      "qfn30_5x5_p0.5": "a QFN has a pin count divisible by 4",
      "qfn32_5x6_p0.5": "QFN bodies must be square",
      "qfn64_5x5_p0.5": "16 pins a side at 0.5 mm do not fit a 5 mm side",
      "qfn32_5x5_p0.5_ep": "_ep needs the exposed pad's size, such as _ep3.1 or _ep1.6x2.4",
      "qfn32_5x5_p0.5_ep4.8": "the exposed pad would touch the pins",
      "qfn32_5x5_p0.5_ep4.5": "the exposed pad would touch the pins",
      "qfn32_5x5_p0.5_w5": "a QFN takes only _p and _ep, not _w",
      "lqfp64_10x10_p0.5_ep3": "a QFP takes only _p",
      "lqfp64_10x10_p1": "QFP pitch must be 0.4, 0.5, 0.65 or 0.8 mm",
      "qfn32_5x5_p0.5_rows2x2": "a QFN takes only _p and _ep, not _rows",
      "qfn28_5x5_p0.65": "the pins would come closer than 0.1 mm to each other",
      "dfn8_3x3": "a DFN needs its pitch, such as _p0.65",
      "dfn7_3x3_p0.65": "a DFN has a pin count divisible by 2",
      "dfn8_3x3_p0.65_ep2.8x2": "the exposed pad would touch the pins",
      "dfn6_2x2_p0.65_ep1x1.6": "the exposed pad would touch the pins",
      "dfn8_3x1_p0.65": "4 pins a side at 0.65 mm do not fit a 1 mm side",
      "dfn8": "a DFN needs its body, such as dfn8_3x3_p0.65",
      "qfn32_0.5x0.5_p0.5": "a QFN body is 1 to 60 mm",
      "qfn32_5x5_p0.5s": null,
    })
    expect(generateFootprint("qfn2048_60x60_p0.5")).toHaveProperty("error")
  })
})
