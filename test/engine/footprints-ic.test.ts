import { describe, expect, test } from "vitest"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import { generateFootprint, padCount } from "../../src/engine/footprints/index.js"
import {
  FINE_PITCH_GULL_WING_TABLE,
  GULL_WING_TABLE,
  gullWingGoals,
  gullWingTable,
  QFN_TABLE,
} from "../../src/engine/footprints/ipc7351.js"
import { nearestFootprints, unknownFootprint } from "../../src/engine/footprints/known.js"
import { parseFootprint } from "../../src/engine/footprints/parse.js"
import type { Footprint, Pad } from "../../src/engine/footprints/types.js"
import type { Circuit, Point } from "../../src/engine/model.js"

const EPS = 1e-9

function footprint(text: string): Footprint {
  const result = generateFootprint(text)
  if ("error" in result) throw new Error(result.error)
  return result
}

function pad(fp: Footprint, number: number): Pad {
  const found = fp.pads.find((p) => p.number === String(number))
  if (!found) throw new Error(`${fp.name} has no pad ${number}`)
  return found
}

function box(p: Pad) {
  return { minX: p.x - p.width / 2, maxX: p.x + p.width / 2, minY: p.y - p.height / 2, maxY: p.y + p.height / 2 }
}

function courtyardHalf(fp: Footprint) {
  return { x: Math.max(...fp.courtyard.map((p) => Math.abs(p.x))), y: Math.max(...fp.courtyard.map((p) => Math.abs(p.y))) }
}

function segments(lines: Point[][]): [Point, Point][] {
  return lines.flatMap((line) => line.slice(1).map((end, i) => [line[i] as Point, end] as [Point, Point]))
}

/** Distance from a segment to a pad's box (0 when they touch), sampled along the segment. */
function segmentToBox(a: Point, b: Point, target: ReturnType<typeof box>): number {
  let best = Infinity
  const steps = 400
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = a.x + (b.x - a.x) * t
    const y = a.y + (b.y - a.y) * t
    const dx = Math.max(target.minX - x, 0, x - target.maxX)
    const dy = Math.max(target.minY - y, 0, y - target.maxY)
    best = Math.min(best, Math.hypot(dx, dy))
  }
  return best
}

/** Pad size along its lead and across it, and the distance between the centres of two opposite pads. */
interface RowSize {
  length: number
  width: number
  centres: number
}

/** `first` and `opposite` face each other across the part; `along` is the axis their leads lie on. */
function expectRows(text: string, first: number, opposite: number, along: "x" | "y", expected: RowSize, within: number) {
  const fp = footprint(text)
  const a = pad(fp, first)
  const b = pad(fp, opposite)
  const length = along === "x" ? a.width : a.height
  const width = along === "x" ? a.height : a.width
  const centres = along === "x" ? b.x - a.x : b.y - a.y
  expect(Math.abs(length - expected.length)).toBeLessThanOrEqual(within + EPS)
  expect(Math.abs(width - expected.width)).toBeLessThanOrEqual(within + EPS)
  expect(Math.abs(centres - expected.centres)).toBeLessThanOrEqual(within + EPS)
}

/** Every IC family string with its IPC-7351B level B courtyard excess (Tables 3-2, 3-3 and 3-15 all give 0.25). */
const IC_FAMILIES = [
  "sot23",
  "sot23_5",
  "sot23_6",
  "soic8",
  "soic14",
  "soic16",
  "soic10",
  "soic12",
  "soic16w",
  "soic18w",
  "soic20w",
  "soic24w",
  "soic28w",
  "sop8",
  "sop16",
  "ssop14",
  "ssop20",
  "ssop28",
  "tssop8",
  "tssop14",
  "tssop16",
  "tssop20",
  "tssop22",
  "tssop28",
  "qfp32",
  "qfp48",
  "qfp64",
  "qfp100",
  "qfn16",
  "qfn32",
  "qfn48",
  "qfn16_ep",
  "qfn32_ep",
  "qfn48_ep",
]
const IC_COURTYARD_EXCESS = 0.25

describe("numbering goes counter-clockwise from pad 1", () => {
  test("sot23_5: pads 1 to 3 run left to right along the bottom, 4 and 5 right to left along the top", () => {
    const fp = footprint("sot23_5")
    const [p1, p2, p3, p4, p5] = [1, 2, 3, 4, 5].map((n) => pad(fp, n)) as [Pad, Pad, Pad, Pad, Pad]
    expect(p1.y).toBeLessThan(0)
    expect(p2.y).toBe(p1.y)
    expect(p3.y).toBe(p1.y)
    expect(p1.x).toBeLessThan(p2.x)
    expect(p2.x).toBeLessThan(p3.x)
    expect(p4.y).toBeGreaterThan(0)
    expect(p5.y).toBe(p4.y)
    expect(p4.x).toBeGreaterThan(p5.x)
  })

  test("sot23: pad 1 bottom left, pad 2 bottom right, pad 3 top centre", () => {
    const fp = footprint("sot23")
    expect(fp.pads).toHaveLength(3)
    expect(pad(fp, 1)).toMatchObject({ x: -0.95 })
    expect(pad(fp, 2)).toMatchObject({ x: 0.95, y: pad(fp, 1).y })
    expect(pad(fp, 1).y).toBeLessThan(0)
    expect(pad(fp, 3)).toMatchObject({ x: 0 })
    expect(pad(fp, 3).y).toBeGreaterThan(0)
  })

  test("sot23_6: pads 4 to 6 run right to left along the top", () => {
    const fp = footprint("sot23_6")
    expect(fp.pads.map((p) => p.x)).toEqual([-0.95, 0, 0.95, 0.95, 0, -0.95])
    expect(fp.pads.map((p) => Math.sign(p.y))).toEqual([-1, -1, -1, 1, 1, 1])
  })

  test("soic8: the left column runs top to bottom, the right column bottom to top", () => {
    const fp = footprint("soic8")
    const xs = fp.pads.map((p) => p.x)
    const ys = fp.pads.map((p) => p.y)
    expect(pad(fp, 1).x).toBe(Math.min(...xs))
    expect(pad(fp, 1).y).toBe(Math.max(...ys))
    expect(pad(fp, 8).x).toBe(Math.max(...xs))
    expect(pad(fp, 8).y).toBe(Math.max(...ys))
    expect([1, 2, 3, 4].map((n) => pad(fp, n).y)).toEqual([1.905, 0.635, -0.635, -1.905])
    expect([5, 6, 7, 8].map((n) => pad(fp, n).y)).toEqual([-1.905, -0.635, 0.635, 1.905])
  })

  test("qfp48: pad 13 is the leftmost pad of the bottom side", () => {
    const fp = footprint("qfp48")
    const bottomY = Math.min(...fp.pads.map((p) => p.y))
    const bottom = fp.pads.filter((p) => Math.abs(p.y - bottomY) < EPS)
    expect(bottom).toHaveLength(12)
    const leftmost = bottom.reduce((a, b) => (b.x < a.x ? b : a))
    expect(leftmost.number).toBe("13")
  })

  test("quad packages: left side top to bottom, bottom left to right, right bottom to top, top right to left", () => {
    for (const text of ["qfp48", "qfn32"]) {
      const fp = footprint(text)
      const n = fp.pads.length / 4
      const side = (from: number) => Array.from({ length: n }, (_, i) => pad(fp, from + i))
      const left = side(1)
      const bottom = side(n + 1)
      const right = side(2 * n + 1)
      const top = side(3 * n + 1)
      expect(new Set(left.map((p) => p.x)).size).toBe(1)
      expect(left[0]?.x).toBeLessThan(0)
      expect(left.map((p) => p.y)).toEqual([...left.map((p) => p.y)].sort((a, b) => b - a))
      expect(bottom.map((p) => p.x)).toEqual([...bottom.map((p) => p.x)].sort((a, b) => a - b))
      expect(bottom[0]?.y).toBeLessThan(0)
      expect(right.map((p) => p.y)).toEqual([...right.map((p) => p.y)].sort((a, b) => a - b))
      expect(right[0]?.x).toBeGreaterThan(0)
      expect(top.map((p) => p.x)).toEqual([...top.map((p) => p.x)].sort((a, b) => b - a))
      expect(top[0]?.y).toBeGreaterThan(0)
    }
  })
})

describe("pitch", () => {
  /** The distance between pads n and n + 1 for every n that does not end a side. */
  function neighbourDistances(text: string, perSide: number): number[] {
    const fp = footprint(text)
    const out: number[] = []
    for (let n = 1; n < fp.pads.length; n++) {
      if (n % perSide === 0) continue
      const a = pad(fp, n)
      const b = pad(fp, n + 1)
      out.push(Math.hypot(b.x - a.x, b.y - a.y))
    }
    return out
  }
  test.each([
    ["soic8", 4, 1.27],
    ["tssop20", 10, 0.65],
    ["qfn32_p0.5mm", 8, 0.5],
    ["qfp48", 12, 0.5],
    ["qfp32", 8, 0.8],
  ] as const)("%s neighbours are %s per side, %s mm apart", (text, perSide, pitch) => {
    for (const d of neighbourDistances(text, perSide)) expect(d).toBeCloseTo(pitch, 9)
  })
})

describe("published land patterns", () => {
  // F 0.10, P 0.05 (as in Task 3). Z, G and X round to the nearest 0.05 mm (the round-off rows of
  // IPC-7351B Tables 3-2, 3-3 and 3-15). Pad length (Z − G)/2 along the lead, X across it, and the
  // centres of opposite rows (Z + G)/2 apart.

  test("SOT-23-5 follows the cited dimensions and goals", () => {
    // IPC name: SOT95P280X145-5N, density level B.
    // no independent source found
    // Diodes Inc. "SOT25 Package Information", Rev. 2017-04-11, p. 1: C (span) 2.70–3.00, L (foot)
    // 0.35–0.55, A (lead width) 0.35–0.50, B (body width) 1.50–1.70. Pitch 0.95 > 0.625, so IPC-7351B
    // Table 3-2 level B: Jt 0.35, Js 0.03. Note 1 applies (Smin 1.60 ≤ Amax, the body width 1.70; the
    // terminal tolerance 0.20 is under 0.5), so Jh = 0.15.
    // Z = 2.70 + 2·0.35 + √(0.30² + 0.10² + 0.05²) = 3.40 + 0.3202 = 3.7202 → 3.70 (74.40 → 74)
    // Smin = 2.70 − 2·0.55 = 1.60, Smax = 3.00 − 2·0.35 = 2.30, CS = 0.70
    // CSrms = √(0.30² + 2·0.20²) = 0.4123, Smax' = 2.30 − (0.70 − 0.4123)/2 = 2.1562
    // G = Smax' − 2·Jh − √(CL² + F² + P²) (ipc7351.ts, gullWingPattern) = 2.1562 − 0.30 − 0.3202
    //   = 1.5360 → 1.55 (30.72 → 31)
    // X = 0.35 + 2·0.03 + √(0.15² + 0.10² + 0.05²) = 0.41 + 0.1871 = 0.5971 → 0.60 (11.94 → 12)
    // Pad (3.70 − 1.55)/2 = 1.075 along the lead, 0.60 across, rows (3.70 + 1.55)/2 = 2.625 apart.
    expectRows("sot23_5", 1, 5, "y", { length: 1.075, width: 0.6, centres: 2.625 }, 0.005)
  })

  test("SOIC-8 (span 5.80–6.20, foot 0.41–1.27, lead 0.33–0.51, body 3.80–4.00) gives the IPC nominal SOIC127P600X175-8N", () => {
    // IPC name: SOIC127P600X175-8N, density level B: the IPC-7351B nominal pattern has pads
    // 1.55 × 0.60 with centres ±2.70 (inner edges 3.85 apart); this comes to 1.525 × 0.60 at ±2.6875.
    // Monolithic Power Systems, "Package outline drawing for 8-SOIC", MF-PO-D-0001 revision 3.0
    // (conforms to JEDEC MS-012 AA): span 5.80–6.20, foot 0.41–1.27, lead width 0.33–0.51, body width
    // 3.80–4.00. Table 3-2 level B: Jt 0.35, Js 0.03. Note 2: the terminal tolerance 0.86 exceeds 0.5,
    // so Note 1 does not apply and Jh = 0.35.
    // Z = 5.80 + 0.70 + √(0.40² + 0.10² + 0.05²) = 6.50 + 0.4153 = 6.9153 → 6.90 (138.31 → 138)
    // Smin = 5.80 − 2·1.27 = 3.26, Smax = 6.20 − 2·0.41 = 5.38, CS = 2.12
    // CSrms = √(0.40² + 2·0.86²) = 1.2803, Smax' = 5.38 − (2.12 − 1.2803)/2 = 4.9602
    // G = 4.9602 − 0.70 − √(0.40² + 0.10² + 0.05²) = 4.2602 − 0.4153 = 3.8449 → 3.85 (76.90 → 77)
    // X = 0.33 + 0.06 + √(0.18² + 0.10² + 0.05²) = 0.39 + 0.2119 = 0.6019 → 0.60 (12.04 → 12)
    // Pad (6.90 − 3.85)/2 = 1.525 along the lead, 0.60 across, columns (6.90 + 3.85)/2 = 5.375 apart.
    expectRows("soic8", 1, 8, "x", { length: 1.525, width: 0.6, centres: 5.375 }, 0.005)
  })

  test("SOIC-18 wide (MS-013: span 10.00–10.65, foot 0.40–1.27, lead 0.31–0.51, body 7.40–7.60) near SOIC127P1030X265-18N", () => {
    // Table 3-2 level B; Note 2: the terminal tolerance 0.87 exceeds 0.5, so Jh = 0.35.
    // Z = 10.00 + 0.70 + √(0.65² + 0.10² + 0.05²) = 10.70 + 0.6595 = 11.3595 → 11.35 (227.19 → 227)
    // Smin = 10.00 − 2.54 = 7.46, Smax = 10.65 − 0.80 = 9.85, CS = 2.39
    // CSrms = √(0.65² + 2·0.87²) = 1.3915, Smax' = 9.85 − (2.39 − 1.3915)/2 = 9.3508
    // G = 9.3508 − 0.70 − 0.6595 = 7.9912 → 8.00 (159.82 → 160)
    // X = 0.31 + 0.06 + √(0.20² + 0.10² + 0.05²) = 0.37 + 0.2291 = 0.5991 → 0.60
    // Pad (11.35 − 8.00)/2 = 1.675 along the lead, 0.60 across, columns (11.35 + 8.00)/2 = 9.675 apart.
    expectRows("soic18w", 1, 18, "x", { length: 1.675, width: 0.6, centres: 9.675 }, 0.005)
    const fp = footprint("soic18w")
    expect(fp.pads).toHaveLength(18)
    expect(fp.origin).toBe("IPC-7351B nominal, SOIC-18 wide")
    // MS-013 AB: D 11.35–11.75, so the body reaches y = ±5.875; the courtyard x is max(4.8375 + 0.8375, 5.325) + 0.25.
    expect(courtyardHalf(fp).x).toBeCloseTo(5.95, 9)
    expect(courtyardHalf(fp).y).toBeCloseTo(6.15, 9)
  })

  test("TSSOP-20 follows the cited dimensions and goals", () => {
    // IPC name: SOP65P640X110-20N (the cited outline's 1.1 mm height), density level B.
    // no independent source found
    // NXP, "TSSOP20 SOT360-1 package information", 8 February 2016 (JEDEC MO-153): HE 6.2–6.6,
    // bp 0.19–0.30, E (body width) 4.3–4.5, with MO-153's foot L 0.45–0.75 (NXP gives Lp 0.50–0.75).
    // Pitch 0.65 > 0.625, so Table 3-2 level B: Jt 0.35, Js 0.03. Note 1 does not apply (Smin 4.70 >
    // Amax, the body width 4.50), so Jh = 0.35.
    // Z = 6.20 + 0.70 + √(0.40² + 0.10² + 0.05²) = 6.90 + 0.4153 = 7.3153 → 7.30 (146.31 → 146)
    // Smin = 6.20 − 2·0.75 = 4.70, Smax = 6.60 − 2·0.45 = 5.70, CS = 1.00
    // CSrms = √(0.40² + 2·0.30²) = 0.5831, Smax' = 5.70 − (1.00 − 0.5831)/2 = 5.4916
    // G = 5.4916 − 0.70 − √(0.40² + 0.10² + 0.05²) = 4.7916 − 0.4153 = 4.3763 → 4.40 (87.53 → 88)
    // X = 0.19 + 0.06 + √(0.11² + 0.10² + 0.05²) = 0.25 + 0.1568 = 0.4068 → 0.40 (8.14 → 8)
    // Pad (7.30 − 4.40)/2 = 1.45 along the lead, 0.40 across, columns (7.30 + 4.40)/2 = 5.85 apart.
    expectRows("tssop20", 1, 20, "x", { length: 1.45, width: 0.4, centres: 5.85 }, 0.005)
  })

  test("QFP-48 follows the cited dimensions and goals", () => {
    // IPC name: QFP50P900X900X160-48N, density level B.
    // no independent source found
    // NXP, "LQFP48 SOT313-2 package information", 8 February 2016 (JEDEC MS-026): HD 8.85–9.15,
    // Lp 0.45–0.75, bp 0.17–0.27, D (body) 6.9–7.1. Pitch 0.5 ≤ 0.625, so IPC-7351B Table 3-3 level B:
    // Jt 0.35, Js −0.02. Note 1 does not apply (Smin 7.35 > Amax, the body 7.10), so Jh = 0.35.
    // Z = 8.85 + 0.70 + √(0.30² + 0.10² + 0.05²) = 9.55 + 0.3202 = 9.8702 → 9.85 (197.40 → 197)
    // Smin = 8.85 − 2·0.75 = 7.35, Smax = 9.15 − 2·0.45 = 8.25, CS = 0.90
    // CSrms = √(0.30² + 2·0.30²) = 0.5196, Smax' = 8.25 − (0.90 − 0.5196)/2 = 8.0598
    // G = 8.0598 − 0.70 − √(0.30² + 0.10² + 0.05²) = 7.3598 − 0.3202 = 7.0396 → 7.05 (140.79 → 141)
    // X = 0.17 − 0.04 + √(0.10² + 0.10² + 0.05²) = 0.13 + 0.15 = 0.28 → 0.30 (5.6 → 6)
    // Pad (9.85 − 7.05)/2 = 1.40 along the lead, 0.30 across, sides (9.85 + 7.05)/2 = 8.45 apart.
    // Pad 1 (top of the left side) faces pad 36 (top of the right side).
    expectRows("qfp48", 1, 36, "x", { length: 1.4, width: 0.3, centres: 8.45 }, 0.005)
  })

  test("QFN-32 follows the cited dimensions and goals", () => {
    // IPC name: QFN50P500X500X100-33N, density level B.
    // no independent source found
    // NXP, "HVQFN32 SOT617-1 package information", 12 July 2021 (JEDEC MO-220): D 4.9–5.1 (the
    // terminals end at the body edge, so this is the span), L 0.3–0.5, b 0.18–0.30, Dh 2.95–3.25.
    // IPC-7351B Table 3-15 level B: Jt 0.30, Jh 0, Js −0.04.
    // Z = 4.90 + 0.60 + √(0.20² + 0.10² + 0.05²) = 5.50 + 0.2291 = 5.7291 → 5.75 (114.58 → 115)
    // Smin = 4.90 − 2·0.50 = 3.90, Smax = 5.10 − 2·0.30 = 4.50, CS = 0.60
    // CSrms = √(0.20² + 2·0.20²) = 0.3464, Smax' = 4.50 − (0.60 − 0.3464)/2 = 4.3732
    // G = 4.3732 − 0 − √(0.3464² + 0.10² + 0.05²) = 4.3732 − 0.3640 = 4.0092 → 4.00 (80.18 → 80)
    // X = 0.18 − 0.08 + √(0.12² + 0.10² + 0.05²) = 0.10 + 0.1640 = 0.2640 → 0.25 (5.28 → 5)
    // Pad (5.75 − 4.00)/2 = 0.875 along the terminal, 0.25 across, sides (5.75 + 4.00)/2 = 4.875 apart.
    expectRows("qfn32_ep", 1, 24, "x", { length: 0.875, width: 0.25, centres: 4.875 }, 0.005)
    // The exposed pad is the drawing's nominal Dh × Eh: (2.95 + 3.25)/2 = 3.10.
    expect(pad(footprint("qfn32_ep"), 33)).toMatchObject({ x: 0, y: 0, width: 3.1, height: 3.1 })
  })
})

describe("the other IC packages, worked by hand", () => {
  // Same equations and rounding; pad length × width and the centre distance of opposite rows.
  test.each([
    // NXP SOT23 (TO-236AB), 9 January 2017: HE 2.1–2.5, Lp 0.15–0.45, bp 0.38–0.48, E 1.2–1.4.
    // Table 3-2 with Note 1 (Smin 1.20 ≤ 1.40, terminal tolerance 0.30): Z 2.80 + 0.4153 = 3.2153 → 3.20;
    // CSrms √(0.16 + 0.18) = 0.5831, Smax' 2.20 − (1.00 − 0.5831)/2 = 1.9915,
    // G 1.9915 − 0.30 − √(0.16 + 0.0125) = 1.2762 → 1.30; X 0.44 + 0.15 = 0.59 → 0.60.
    ["sot23", 1, 3, "y", { length: 0.95, width: 0.6, centres: 2.25 }],
    // Diodes SOT26, Rev. 2021-03-02: E 2.70–3.00, L 0.35–0.55, b 0.35–0.50, E1 1.50–1.70: as SOT-23-5.
    ["sot23_6", 1, 6, "y", { length: 1.075, width: 0.6, centres: 2.625 }],
    // MPS 14-SOIC and 16-SOIC (MS-012 AB, AC): the leads are those of the 8-SOIC above.
    ["soic14", 1, 14, "x", { length: 1.525, width: 0.6, centres: 5.375 }],
    ["soic16", 1, 16, "x", { length: 1.525, width: 0.6, centres: 5.375 }],
    // Giantec 8L 208mil SOP, Rev. A 04/22/2013: E 7.70–8.10, L 0.51–0.80, b 0.36–0.48, E1 5.18–5.38.
    // Table 3-2, Note 1 does not apply (Smin 6.10 > 5.38): Z 8.40 + 0.4153 = 8.8153 → 8.80;
    // CSrms √(0.16 + 2·0.29²) = 0.5729, Smax' 7.08 − (0.98 − 0.5729)/2 = 6.8764,
    // G 6.8764 − 0.70 − 0.4153 = 5.7611 → 5.75; X 0.42 + 0.1640 = 0.5840 → 0.60.
    ["sop8", 1, 8, "x", { length: 1.525, width: 0.6, centres: 7.275 }],
    // NXP TSSOP14 SOT402-1 and TSSOP16 SOT403-1: the leads are those of TSSOP20 SOT360-1.
    ["tssop14", 1, 14, "x", { length: 1.45, width: 0.4, centres: 5.85 }],
    ["tssop16", 1, 16, "x", { length: 1.45, width: 0.4, centres: 5.85 }],
    // NXP LQFP32 SOT358-1: HD 8.85–9.15, Lp 0.45–0.75, bp 0.30–0.40, D 6.9–7.1, pitch 0.8 > 0.625, so
    // Table 3-2 (Js 0.03): Z and G as QFP-48 (9.85, 7.05); X 0.30 + 0.06 + 0.15 = 0.51 → 0.50.
    ["qfp32", 1, 24, "x", { length: 1.4, width: 0.5, centres: 8.45 }],
    // NXP LQFP64 SOT314-2: HD 11.85–12.15, Lp 0.45–0.75, bp 0.17–0.27, D 9.9–10.1; Table 3-3:
    // Z 12.55 + 0.3202 = 12.8702 → 12.85; Smax' 11.25 − 0.1902 = 11.0598, G 11.0598 − 0.70 − 0.3202
    // = 10.0396 → 10.05; X 0.28 → 0.30.
    ["qfp64", 1, 48, "x", { length: 1.4, width: 0.3, centres: 11.45 }],
    // NXP LQFP100 SOT407-1: HD 15.75–16.25, Lp 0.45–0.75, bp 0.17–0.27, D 13.9–14.1; Table 3-3:
    // Z 16.45 + √(0.25 + 0.0125) = 16.9623 → 16.95; CSrms √(0.25 + 0.18) = 0.6557,
    // Smax' 15.35 − (1.10 − 0.6557)/2 = 15.1279, G 15.1279 − 0.70 − √(0.25 + 0.0125) = 13.9156 → 13.90;
    // X 0.28 → 0.30.
    ["qfp100", 1, 75, "x", { length: 1.525, width: 0.3, centres: 15.425 }],
    // The wider families by pin count: MS-013 (soic<N>w) leads as SOIC-18 wide above; MO-150 SSOP
    // (E 7.40–8.20, L 0.55–0.95, b 0.22–0.38, E1 5.00–5.60), pitch 0.65 so Table 3-2; Note 1 applies
    // (Smin 5.50 ≤ 5.60, terminal tolerance 0.40): Z 8.10 + √(0.64 + 0.0125) = 8.9078 → 8.90;
    // Smin 5.50, Smax 8.20 − 1.10 = 7.10, CSrms √(0.64 + 0.32) = 0.9798, Smax' 7.10 − (1.60 − 0.9798)/2
    // = 6.7899, G 6.7899 − 0.30 − 0.8078 = 5.6821 → 5.70; X 0.28 + 0.1952 = 0.4752 → 0.50.
    // TSSOP-8 and TSSOP-28 (MO-153) have the TSSOP-20 leads.
    ["ssop20", 1, 20, "x", { length: 1.6, width: 0.5, centres: 7.3 }],
    ["soic28w", 1, 28, "x", { length: 1.675, width: 0.6, centres: 9.675 }],
    ["tssop8", 1, 8, "x", { length: 1.45, width: 0.4, centres: 5.85 }],
    ["tssop28", 1, 28, "x", { length: 1.45, width: 0.4, centres: 5.85 }],
    // NXP HVQFN16 SOT758-1 (D 2.9–3.1) and HVQFN48 SOT619-1 (D 6.9–7.1): L and b as HVQFN32, so the
    // pads are the same and only Z and G move with D: Z 3.75 / 7.75, G 2.00 / 6.00.
    ["qfn16", 1, 12, "x", { length: 0.875, width: 0.25, centres: 2.875 }],
    ["qfn48", 1, 36, "x", { length: 0.875, width: 0.25, centres: 6.875 }],
  ] as const)("%s", (text, first, opposite, along, expected) => {
    expectRows(text, first, opposite, along, expected, 0.0005)
  })
})

describe("courtyards, worked by hand", () => {
  // Half size = larger of the pad extent and the component extent, plus 0.25, rounded up to 0.05.
  test.each([
    ["sot23", 1.75, 1.85], // x max(1.25, D 1.50) + 0.25; y max(1.075 + 0.525, HE 1.25) + 0.25
    ["sot23_5", 1.8, 2.1], // x max(1.25, 1.55) + 0.25; y max(1.2875 + 0.5625, 1.50) + 0.25
    ["soic8", 3.7, 2.75], // x max(2.4625 + 0.9875, 3.10) + 0.25; y max(2.205, D 2.50) + 0.25
    ["sop8", 4.65, 2.95], // x max(3.60 + 0.80, 4.05) + 0.25; y max(2.205, 2.665) + 0.25 = 2.915 → 2.95
    ["tssop20", 3.9, 3.55], // x max(2.8625 + 0.7875, 3.30) + 0.25; y max(3.125, 3.30) + 0.25
    ["qfp48", 5.2, 5.2], // max(4.175 + 0.75, 4.575) + 0.25 = 5.175 → 5.20
    ["qfn32_ep", 3.15, 3.15], // max(2.4375 + 0.4375, 2.55) + 0.25 = 3.125 → 3.15
  ] as const)("%s", (text, x, y) => {
    const half = courtyardHalf(footprint(text))
    expect(half.x).toBeCloseTo(x, 9)
    expect(half.y).toBeCloseTo(y, 9)
  })
})

describe("every IC family", () => {
  test.each(IC_FAMILIES)("%s: pads never overlap and the courtyard holds them", (text) => {
    const fp = footprint(text)
    const boxes = fp.pads.map(box)
    boxes.forEach((a, i) =>
      boxes.slice(i + 1).forEach((b) => {
        const apart = Math.max(b.minX - a.maxX, a.minX - b.maxX, b.minY - a.maxY, a.minY - b.maxY)
        expect(apart).toBeGreaterThan(0)
      }),
    )
    const half = courtyardHalf(fp)
    for (const b of boxes) {
      expect(half.x - Math.max(Math.abs(b.minX), Math.abs(b.maxX))).toBeGreaterThanOrEqual(IC_COURTYARD_EXCESS - EPS)
      expect(half.y - Math.max(Math.abs(b.minY), Math.abs(b.maxY))).toBeGreaterThanOrEqual(IC_COURTYARD_EXCESS - EPS)
    }
  })

  test.each(IC_FAMILIES)("%s: pads are top-side round rectangles numbered from 1", (text) => {
    const fp = footprint(text)
    fp.pads.forEach((p, i) => {
      expect(p.number).toBe(String(i + 1))
      expect(p.shape).toBe("roundrect")
      expect(p.layers).toBe("top")
      expect(p.rotation).toBe(0)
      expect(p.drill).toBeUndefined()
      expect(p.cornerRadius).toBeCloseTo(Math.min(0.25, 0.25 * Math.min(p.width, p.height)), 9)
    })
  })

  test.each(IC_FAMILIES)("%s: silkscreen keeps 0.15 mm away from pads", (text) => {
    const fp = footprint(text)
    expect(fp.silkscreen.length).toBeGreaterThanOrEqual(2)
    for (const [a, b] of segments(fp.silkscreen)) {
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0)
      for (const p of fp.pads) expect(segmentToBox(a, b, box(p))).toBeGreaterThanOrEqual(0.15 - 1e-6)
    }
  })

  test.each(IC_FAMILIES)("%s: a body outline, an origin and a name", (text) => {
    const fp = footprint(text)
    expect(fp.fabrication.length).toBeGreaterThanOrEqual(1)
    expect(fp.origin).toMatch(/^IPC-7351B nominal, /)
    expect(fp.name).toBe(text)
  })
})

test("origin names the package", () => {
  expect(footprint("sot23_5").origin).toBe("IPC-7351B nominal, SOT-23-5")
  expect(footprint("soic8").origin).toBe("IPC-7351B nominal, SOIC-8")
  expect(footprint("tssop20").origin).toBe("IPC-7351B nominal, TSSOP-20")
  expect(footprint("qfp48").origin).toBe("IPC-7351B nominal, LQFP-48")
  expect(footprint("qfn32_ep").origin).toBe("IPC-7351B nominal, QFN-32 with exposed pad")
})

test("_p and _w only confirm the package; other values are refused", () => {
  expect(footprint("soic8_p1.27mm").pads).toEqual(footprint("soic8").pads)
  expect(footprint("soic8_w6mm_p1.27mm").pads).toEqual(footprint("soic8").pads)
  expect(footprint("tssop20_w6.4mm").pads).toEqual(footprint("tssop20").pads)
  expect(footprint("qfp48_p0.5mm_w9mm").pads).toEqual(footprint("qfp48").pads)
  expect(footprint("qfn32_ep_w5mm").pads).toEqual(footprint("qfn32_ep").pads)
  expect(footprint("sot23_5_p0.95mm").pads).toEqual(footprint("sot23_5").pads)
  for (const text of ["soic8_p0.65mm", "soic8_w5.3mm", "tssop20_p0.5mm", "qfn32_p0.65mm", "qfp48_w12mm"]) {
    expect(generateFootprint(text)).toEqual({ error: unknownFootprint(text) })
  }
})

test("padCount", () => {
  expect(padCount("qfn32_ep")).toBe(33)
  expect(padCount("qfn32")).toBe(32)
  expect(padCount("sot23")).toBe(3)
  expect(padCount("sot23_6")).toBe(6)
  expect(padCount("qfp100")).toBe(100)
  expect(padCount("pinrow7")).toBe(7)
})

test("strings outside the cited tables are refused", () => {
  for (const text of [
    "soic9",
    "soic",
    "soic20",
    "soic18",
    "soic8w",
    "soic14w",
    "soic08",
    "sop18",
    "ssop30",
    "tssop6",
    "tssop30",
    "qfp47",
    "qfn20",
    "sot23_4",
    "sot23_5_ep",
    "tssop20_ep",
    "soic8_5",
    "qfn32_x1",
    "qfn32_ep2mm",
    "pinrow0",
    "pinrow",
    "pinrow2_w3mm",
    "pinrow2_3",
    "pinrow2_p1.27mm",
    "pinrow1001",
    "0603_5",
    "sod123_5",
  ]) {
    expect(generateFootprint(text)).toEqual({ error: unknownFootprint(text) })
  }
})

describe("the refusal of an unknown string names what exists", () => {
  test("it lists the string forms on one line and points at the skill", () => {
    const error = unknownFootprint("to247")
    expect(error).toMatch(/^copperflow cannot make footprint "to247":/)
    expect(error).not.toContain("\n")
    for (const form of ["0603", "sot23_5", "soic<N> (N even 8–16)", "soic<N>w (N 16, 18, 20, 24, 28)", "sop<N>", "ssop<N>", "tssop<N> (N even 8–28)", "qfn<N>_<b>x<b>_p<pitch>", "pinrow<N>", "dip<N>"]) {
      expect(error).toContain(form)
    }
    expect(error).toMatch(/\(see the skill's parts library reference\)$/)
  })

  test("a known family with a bad number or suffix gets the nearest valid strings", () => {
    expect(nearestFootprints("soic18")).toEqual(["soic16", "soic18w", "soic14"].sort(byPins))
    expect(nearestFootprints("soic14w")).toEqual(["soic14", "soic16w", "soic18w"].sort(byPins))
    expect(nearestFootprints("tssop30")).toEqual(["tssop24", "tssop26", "tssop28"])
    expect(nearestFootprints("qfn20")).toEqual(["qfn16", "qfn32", "qfn48"])
    expect(nearestFootprints("0604")).toEqual(["0402", "0603", "0805"])
    expect(generateFootprint("soic18")).toEqual({ error: expect.stringMatching(/^copperflow cannot make footprint "soic18": nearest are soic14, soic16, soic18w; known families are /) })
  })

  test("every string the refusal suggests builds a footprint", () => {
    const suggested = new Set<string>()
    for (const text of ["soic18", "soic8w", "soic30w", "sop20", "ssop8", "tssop30", "qfn20", "qfp40", "lqfp50", "tqfp20", "0604", "sod999", "sot24", "do214", "dip3", "pinrow0", "to247", "hc50"]) {
      for (const near of nearestFootprints(text)) suggested.add(near)
    }
    expect(suggested.size).toBeGreaterThan(20)
    for (const text of suggested) expect(generateFootprint(text), text).not.toHaveProperty("error")
  })

  test("a string of no known kind names no nearest strings", () => {
    expect(nearestFootprints("xyz")).toEqual([])
    expect(nearestFootprints("abc12")).toEqual([])
    expect(unknownFootprint("xyz")).toMatch(/^copperflow cannot make footprint "xyz": known families are /)
  })
})

function byPins(a: string, b: string): number {
  return Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]) || a.localeCompare(b)
}

describe("gull-wing heel goal: Amax is the body between the lead rows", () => {
  // The reading is settled in ipc7351.ts (gullWingGoals). These cases are where the two readings
  // part: under a toe-to-toe Amax, Smin would always be under Amax and Note 1 would apply.
  test("TSSOP-20 and SOP-8: feet that end outside the body keep the table heel", () => {
    const tssop = { span: { min: 6.2, max: 6.6 }, terminal: { min: 0.5, max: 0.75 }, width: { min: 0.19, max: 0.3 } }
    expect(gullWingGoals(tssop, 4.5).heel).toBe(0.35) // Smin 4.70 > body 4.50
    expect(gullWingGoals(tssop, 6.6).heel).toBe(0.15) // what a toe-to-toe Amax would give
    const sop = { span: { min: 7.7, max: 8.1 }, terminal: { min: 0.51, max: 0.8 }, width: { min: 0.36, max: 0.48 } }
    expect(gullWingGoals(sop, 5.38).heel).toBe(0.35) // Smin 6.10 > body 5.38
  })
  test("SOT-23: feet that reach under the body get the Note 1 heel", () => {
    const sot23 = { span: { min: 2.1, max: 2.5 }, terminal: { min: 0.15, max: 0.45 }, width: { min: 0.38, max: 0.48 } }
    expect(gullWingGoals(sot23, 1.4).heel).toBe(0.15) // Smin 1.20 ≤ body 1.40
  })
  test("Table 3-3 carries the same Note 1 and its own side goal", () => {
    const lead = { span: { min: 2.1, max: 2.5 }, terminal: { min: 0.15, max: 0.45 }, width: { min: 0.1, max: 0.2 } }
    expect(gullWingGoals(lead, 1.4, FINE_PITCH_GULL_WING_TABLE)).toEqual({ toe: 0.35, heel: 0.15, side: -0.02 })
  })
  test("Table 3-2 above 0.625 mm pitch, Table 3-3 at or below it", () => {
    expect(gullWingTable(1.27)).toBe(GULL_WING_TABLE)
    expect(gullWingTable(0.65)).toBe(GULL_WING_TABLE)
    expect(gullWingTable(0.625)).toBe(FINE_PITCH_GULL_WING_TABLE)
    expect(gullWingTable(0.5)).toBe(FINE_PITCH_GULL_WING_TABLE)
  })
  test("QFN goals are Table 3-15's", () => {
    expect(QFN_TABLE).toEqual({ goals: { toe: 0.3, heel: 0, side: -0.04 }, roundOff: 0.05, courtyardExcess: 0.25 })
    expect(FINE_PITCH_GULL_WING_TABLE).toEqual({ goals: { toe: 0.35, heel: 0.35, side: -0.02 }, roundOff: 0.05, courtyardExcess: 0.25 })
  })
})

test("a QFN without _ep has no exposed pad, and the exposed pad clears the signal pads", () => {
  expect(footprint("qfn32").pads).toHaveLength(32)
  for (const text of ["qfn16_ep", "qfn32_ep", "qfn48_ep"]) {
    const fp = footprint(text)
    const ep = fp.pads[fp.pads.length - 1] as Pad
    expect(ep.number).toBe(String(fp.pads.length))
    expect(ep.x).toBe(0)
    expect(ep.y).toBe(0)
  }
  // HVQFN16 Dh 1.45–1.75 → 1.60; HVQFN48 Dh 4.95–5.25 → 5.10.
  expect(pad(footprint("qfn16_ep"), 17)).toMatchObject({ width: 1.6, height: 1.6 })
  expect(pad(footprint("qfn48_ep"), 49)).toMatchObject({ width: 5.1, height: 5.1 })
})

test("footprint strings may carry a numeric variant", () => {
  expect(parseFootprint("sot23_5")).toEqual({ kind: "sot", code: "23", variant: "5", params: {} })
  expect(parseFootprint("SOT23_6_p0.95mm")).toEqual({ kind: "sot", code: "23", variant: "6", params: { p: 0.95 } })
  expect(parseFootprint("qfn32_ep")).toEqual({ kind: "qfn", code: "32", params: { ep: true } })
  expect(parseFootprint("sot23_p0.95mm_5")).toBeUndefined()
})

describe("pin rows", () => {
  test("pinrow2 is a 2.54 mm header", () => {
    const fp = footprint("pinrow2_p2.54mm")
    expect(fp.pads.map((p) => p.x)).toEqual([-1.27, 1.27])
    for (const p of fp.pads) {
      expect(p.layers).toBe("through")
      expect(p.drill?.width).toBe(1.0)
      expect(p.drill?.height).toBe(1.0)
      expect(p.y).toBe(0)
      expect(p.width).toBe(1.7)
      expect(p.height).toBe(1.7)
    }
    expect(pad(fp, 1).shape).toBe("rect")
    expect(pad(fp, 2).shape).toBe("circle")
    expect(fp.name).toBe("pinrow2_p2.54mm")
  })

  test("the pitch defaults to 2.54 mm and the row is centred", () => {
    const fp = footprint("pinrow3")
    expect(fp.pads.map((p) => p.x)).toEqual([-2.54, 0, 2.54])
    expect(fp.name).toBe("pinrow3_p2.54mm")
    expect(footprint("pinrow4_p100mil").pads.map((p) => p.x)).toEqual([-3.81, -1.27, 1.27, 3.81])
    expect(footprint("pinrow2_p2mm").pads.map((p) => p.x)).toEqual([-1, 1])
  })

  test("the origin says these are fixed values, not an IPC calculation", () => {
    expect(footprint("pinrow2").origin).toBe("Fixed pin row, not an IPC-7351B calculation: 2.54 mm pitch, 1.0 mm drill, 1.7 mm pads")
  })

  test("the courtyard is 0.25 mm outside the pads and the silkscreen 0.15 mm", () => {
    const fp = footprint("pinrow2")
    const half = courtyardHalf(fp)
    expect(half.x).toBeCloseTo(1.27 + 0.85 + 0.25, 9)
    expect(half.y).toBeCloseTo(0.85 + 0.25, 9)
    for (const [a, b] of segments(fp.silkscreen)) {
      for (const p of fp.pads) expect(segmentToBox(a, b, box(p))).toBeGreaterThanOrEqual(0.15 - 1e-6)
    }
    expect(fp.silkscreen.length).toBeGreaterThanOrEqual(1)
  })
})

describe("pinheaders get a pinrow footprint", () => {
  const MAIN = "main.circuit.tsx"
  function build(body: string): Circuit {
    const files = { [MAIN]: `export default () => (\n  <board width="20mm" height="20mm">\n${body}\n  </board>\n)\n` }
    return elaborate(evaluateCircuit(files, MAIN), MAIN, { padCount })
  }
  const of = (circuit: Circuit, id: string) => circuit.components.find((c) => c.id === id)

  test("from pinCount and pitch", () => {
    const circuit = build(`<pinheader name="J2" pinCount={2} pitch="2.54mm" />`)
    expect(of(circuit, "J2")?.footprint).toBe("pinrow2_p2.54mm")
    expect(of(circuit, "J2")?.props["footprint"]).toBeUndefined()
    expect(circuit.diagnostics).toEqual([])
  })

  test("the pitch defaults to 2.54 mm and may be written in mil", () => {
    const circuit = build(
      [`<pinheader name="J3" pinCount={3} />`, `<pinheader name="J4" pinCount={4} pitch="2mm" />`, `<pinheader name="J5" pinCount={1} pitch="100mil" />`].join("\n"),
    )
    expect(of(circuit, "J3")?.footprint).toBe("pinrow3_p2.54mm")
    expect(of(circuit, "J4")?.footprint).toBe("pinrow4_p2mm")
    expect(of(circuit, "J5")?.footprint).toBe("pinrow1_p2.54mm")
  })

  test("a declared footprint wins, and headers without a pin count or with a bad pitch get none", () => {
    const circuit = build(
      [
        `<pinheader name="J6" pinCount={2} footprint="pinrow2_p2mm" />`,
        `<pinheader name="J7" pinLabels={{ pin1: "A" }} />`,
        `<pinheader name="J8" pinCount={2} pitch="wide" />`,
        `<resistor name="R1" />`,
      ].join("\n"),
    )
    expect(of(circuit, "J6")?.footprint).toBe("pinrow2_p2mm")
    expect(of(circuit, "J7")?.footprint).toBeUndefined()
    expect(of(circuit, "J8")?.footprint).toBeUndefined()
    expect(of(circuit, "R1")?.footprint).toBeUndefined()
    expect(circuit.diagnostics).toMatchObject([{ code: "bad-value", items: ["J8.pitch"] }])
  })
})
