import { describe, expect, test } from "vitest"
import { padCount } from "../../src/engine/footprints/index.js"
import { MOLDED_BODY_TABLE } from "../../src/engine/footprints/ipc7351.js"
import { courtyardHalf, EPS, expectWellFormed, footprint, pad, refused } from "./footprint-checks.js"

describe("SOT-223 and SOT-89", () => {
  test("SOT-223, worked by hand: three leads along the bottom, tab 4 on top", () => {
    // HE 6.7–7.3, Lp 0.7–1.1, bp 0.6–0.8, b1 2.9–3.1, E 3.3–3.7, e 2.3. Table 3-2 (pitch 2.3);
    // Note 1 does not apply (Smin = 6.7 − 2.2 = 4.5 > Amax 3.7), so Jt 0.35, Jh 0.35, Js 0.03.
    // Z = 6.70 + 0.70 + √(0.60² + 0.10² + 0.05²) = 7.40 + 0.6103 = 8.0103 → 8.00
    // Smax = 7.30 − 1.40 = 5.90, CSrms = √(0.60² + 2·0.40²) = 0.8246, Smax' = 5.90 − (1.40 − 0.8246)/2 = 5.6123
    // G = 5.6123 − 0.70 − √(0.8246² + 0.10² + 0.05²) = 4.9123 − 0.8322 = 4.0801 → 4.10
    // X = 0.60 + 0.06 + √(0.20² + 0.10² + 0.05²) = 0.66 + 0.2291 = 0.8891 → 0.90; tab 2.90 + 0.2891 = 3.1891 → 3.20
    // Pads (8.00 − 4.10)/2 = 1.95 long, centres ±(8.00 + 4.10)/4 = ±3.025.
    const fp = footprint("sot223")
    expect(fp.pads.map((p) => p.number)).toEqual(["1", "2", "3", "4"])
    expect(pad(fp, 1)).toMatchObject({ x: -2.3, y: -3.025, width: 0.9, height: 1.95 })
    expect(pad(fp, 2)).toMatchObject({ x: 0, y: -3.025 })
    expect(pad(fp, 3)).toMatchObject({ x: 2.3, y: -3.025 })
    expect(pad(fp, 4)).toMatchObject({ x: 0, y: 3.025, width: 3.2, height: 1.95 })
    // Courtyard: pads reach 3.025 + 0.975 = 4.00 → 4.25; the body 3.35 → 3.60.
    expect(courtyardHalf(fp)).toEqual({ x: 3.6, y: 4.25 })
    expectWellFormed(fp)
  })

  test("SOT-89: the tab is a second pad 2", () => {
    // Span 3.94–4.25, foot 0.89–1.20, lead 0.44–0.56, tab 1.62–1.83, body 2.40–2.60 across.
    // Note 1 applies (Smin = 3.94 − 2.40 = 1.54 ≤ 2.60): Jh 0.15.
    // Z = 3.94 + 0.70 + √(0.31² + 0.10² + 0.05²) = 4.64 + 0.3295 = 4.9695 → 4.95
    // Smax = 4.25 − 1.78 = 2.47, CSrms = √(0.31² + 2·0.31²) = 0.5369, Smax' = 2.47 − (0.93 − 0.5369)/2 = 2.2735
    // G = 2.2735 − 0.30 − √(0.5369² + 0.10² + 0.05²) = 1.9735 − 0.5485 = 1.4250 → 1.45 (28.5 rounds up)
    // X = 0.44 + 0.06 + √(0.12² + 0.10² + 0.05²) = 0.50 + 0.1640 = 0.664 → 0.65; tab 1.62 + 0.06 + 0.2379 = 1.918 → 1.90
    const fp = footprint("sot89")
    expect(fp.pads.map((p) => p.number)).toEqual(["1", "2", "3", "2"])
    expect(pad(fp, 1)).toMatchObject({ x: -1.5, y: -1.6, width: 0.65, height: 1.75 })
    expect(fp.pads[3]).toMatchObject({ number: "2", x: 0, y: 1.6, width: 1.9, height: 1.75 })
    expect(padCount("sot89")).toBe(4)
    expect(new Set(fp.pads.map((p) => p.number)).size).toBe(3)
    expectWellFormed(fp)
  })

  test("pin 1 is marked: the left silkscreen line runs down past pad 1", () => {
    for (const text of ["sot223", "sot89"]) {
      const fp = footprint(text)
      const p1 = pad(fp, 1)
      const lowest = Math.min(...(fp.silkscreen[0] ?? []).map((p) => p.y))
      expect(lowest).toBeLessThanOrEqual(p1.y - p1.height / 2 + EPS)
      expect(Math.max(...(fp.silkscreen[0] ?? []).map((p) => p.x))).toBeLessThan(p1.x)
    }
  })

  test("other SOT strings are still refused", () => {
    for (const text of ["sot223_p2.3", "sot89_5", "sot2230", "sot223s"]) refused(text)
  })
})

describe("DO-214 diodes", () => {
  test("SMA, worked by hand", () => {
    // He 4.93–5.28, L 0.76–1.52, b 1.25–1.65; molded body goals Jt 0.15, Jh 0.50, Js −0.05.
    // Z = 4.93 + 0.30 + √(0.35² + 0.10² + 0.05²) = 5.23 + 0.3674 = 5.5974 → 5.60
    // Smin = 4.93 − 3.04 = 1.89, Smax = 5.28 − 1.52 = 3.76, CSrms = √(0.35² + 2·0.76²) = 1.1304
    // Smax' = 3.76 − (1.87 − 1.1304)/2 = 3.3902; G = 3.3902 − 1.00 − √(1.1304² + 0.10² + 0.05²) = 1.2543 → 1.25
    // X = 1.25 − 0.10 + √(0.40² + 0.10² + 0.05²) = 1.15 + 0.4153 = 1.5653 → 1.55
    // Pads (5.60 − 1.25)/2 = 2.175 × 1.55, centres ±(5.60 + 1.25)/4 = ±1.7125.
    expect(MOLDED_BODY_TABLE.goals).toEqual({ toe: 0.15, heel: 0.5, side: -0.05 })
    const fp = footprint("sma")
    expect(pad(fp, 1)).toMatchObject({ x: -1.7125, y: 0, width: 2.175, height: 1.55 })
    expect(pad(fp, 2)).toMatchObject({ x: 1.7125, y: 0 })
    expect(fp.origin).toBe("IPC-7351B nominal, DO-214AC (SMA)")
  })

  test("the JEDEC names are aliases", () => {
    expect(footprint("do214ac").pads).toEqual(footprint("sma").pads)
    expect(footprint("DO214AA").pads).toEqual(footprint("smb").pads)
    expect(footprint("do214ab").pads).toEqual(footprint("smc").pads)
    expect(footprint("smc").pads[0]?.height).toBeGreaterThan(footprint("smb").pads[0]?.height ?? 0)
  })

  test.each(["sma", "smb", "smc"])("%s: well formed, cathode bar on the pad 2 side", (text) => {
    const fp = footprint(text)
    expectWellFormed(fp)
    const bar = fp.silkscreen[2] ?? []
    expect(bar[0]?.x).toBe(bar[1]?.x)
    expect(bar[0]?.x).toBeGreaterThan(0)
  })

  test("other strings are refused", () => {
    for (const text of ["do214", "do214ad", "smd", "sma_p2", "sma_5", "smax2"]) refused(text)
  })
})
