import { describe, expect, test } from "vitest"
import { generateFootprint, padCount } from "../../src/engine/footprints/index.js"
import { gullWingGoals, landPattern, twoTerminalPads } from "../../src/engine/footprints/ipc7351.js"
import { cathodeBar, padExtent } from "../../src/engine/footprints/outline.js"
import { parseFootprint } from "../../src/engine/footprints/parse.js"
import type { Footprint, Pad } from "../../src/engine/footprints/types.js"
import type { Point } from "../../src/engine/model.js"

const FAMILIES = ["0201", "0402", "0603", "0805", "1206", "1210", "1812", "2010", "2512", "sod123", "sod323", "sod523"]
const EPS = 1e-9

function footprint(text: string): Footprint {
  const result = generateFootprint(text)
  if ("error" in result) throw new Error(result.error)
  return result
}

function padBox(pad: Pad) {
  return { minX: pad.x - pad.width / 2, maxX: pad.x + pad.width / 2, minY: pad.y - pad.height / 2, maxY: pad.y + pad.height / 2 }
}

/** Pad width along x, pad height along y and the distance between the two pad centres. */
interface PatternSize {
  width: number
  height: number
  centres: number
}

function expectPattern(text: string, expected: PatternSize, within: number) {
  const pads = footprint(text).pads
  expect(pads).toHaveLength(2)
  const [one, two] = pads as [Pad, Pad]
  expect(Math.abs(one.width - expected.width)).toBeLessThanOrEqual(within + EPS)
  expect(Math.abs(two.width - expected.width)).toBeLessThanOrEqual(within + EPS)
  expect(Math.abs(one.height - expected.height)).toBeLessThanOrEqual(within + EPS)
  expect(Math.abs(two.x - one.x - expected.centres)).toBeLessThanOrEqual(within + EPS)
}

function segments(lines: Point[][]): [Point, Point][] {
  return lines.flatMap((line) => line.slice(1).map((end, i) => [line[i] as Point, end] as [Point, Point]))
}

/** Distance from a segment to a box (0 when they touch). */
function segmentToBox(a: Point, b: Point, box: ReturnType<typeof padBox>): number {
  let best = Infinity
  const steps = 200
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = a.x + (b.x - a.x) * t
    const y = a.y + (b.y - a.y) * t
    const dx = Math.max(box.minX - x, 0, x - box.maxX)
    const dy = Math.max(box.minY - y, 0, y - box.maxY)
    best = Math.min(best, Math.hypot(dx, dy))
  }
  return best
}

test("landPattern follows the IPC-7351B equations", () => {
  const r = landPattern(
    { span: { min: 1.0, max: 1.2 }, terminal: { min: 0.2, max: 0.4 }, width: { min: 0.4, max: 0.6 } },
    { toe: 0.35, heel: 0, side: 0 },
    { fabrication: 0.1, placement: 0.05 },
  )
  expect(r.Z).toBeCloseTo(1.9291, 4)
  expect(r.G).toBeCloseTo(0.3092, 4)
  expect(r.X).toBeCloseTo(0.6291, 4)
})

test("landPattern reproduces a PCB Libraries calculator output", () => {
  // Source: PCB Libraries Forum, "0402 Min Size Land Pattern", post by jayx, 20 Apr 2015,
  // https://www.pcblibraries.com/FORUM/printer_friendly_posts.asp?TID=30
  // Library Expert Lite with its initial settings ("The initial settings are IPC-7351 compliant",
  // Tom H, 21 Apr 2015). Input: KEMET 1005 (EIA 0402) L 1.00 ± 0.05, W 0.50 ± 0.05, terminal
  // 0.30 ± 0.10. Output: pad length 0.59, pad width 0.60, gap 0.22, so Z = 0.22 + 2·0.59 = 1.40,
  // which means a toe of 0.15. G and X do not depend on the toe; with heel 0 and side 0 (IPC-7351B
  // Table 3-6, level B) they check the root-sum-square gap and F = 0.10, P = 0.05.
  // (F = 0.05, P = 0.025 would give X = 0.5646 → 0.57 and G = 0.2448 → 0.24.)
  const r = landPattern(
    { span: { min: 0.95, max: 1.05 }, terminal: { min: 0.2, max: 0.4 }, width: { min: 0.45, max: 0.55 } },
    { toe: 0.15, heel: 0, side: 0 },
    { fabrication: 0.1, placement: 0.05 },
  )
  expect(r.Z).toBeCloseTo(1.4, 2)
  expect(Math.floor(r.G * 100 + EPS) / 100).toBeCloseTo(0.22, 5)
  expect(r.X).toBeCloseTo(0.6, 2)
})

describe("published land patterns", () => {
  test("1206 matches PCB Libraries' IPC-7351B nominal pattern", () => {
    // IPC name: RESC3216 / CAPC3216 (EIA 1206), density level B.
    // Source: PCB Libraries, Inc., "PCB Design Perfection Starts in the CAD Library", PCEA 2025,
    // https://pcea.net/wp-content/uploads/2025/09/PCB-Design-Perfection-Starts-in-the-CAD-Library.pdf
    // Slide 18: the 1206 chip, L 3.00–3.40, T 0.25–0.75, W 1.40–1.80 (the same as our KEMET 1206).
    // Slide 15: PCB Footprint Expert V23, nominal toe 0.35, heel 0.00, side 0.00 (IPC-7351B
    // Table 3-5), fabrication ±0.05, placement ±0.025: pad stack r116_181 (1.16 × 1.81) at x = ±1.475.
    expectPattern("1206", { width: 1.16, height: 1.81, centres: 2.95 }, 0.05)
  })

  test("0402 follows the cited dimensions and goals", () => {
    // IPC name: CAPC1005 (EIA 0402), density level B.
    // no independent source found
    // KEMET 0402: L 0.95–1.05, W 0.45–0.55, T 0.20–0.40. IPC-7351B Table 3-6 nominal: Jt 0.20, Jh 0,
    // Js 0. F 0.10, P 0.05.
    // Z = 0.95 + 2·0.20 + √(0.10² + 0.10² + 0.05²) = 1.35 + 0.15 = 1.50
    // Smin = 0.95 − 2·0.40 = 0.15, Smax = 1.05 − 2·0.20 = 0.65, CS = 0.50
    // CSrms = √(0.10² + 2·0.20²) = 0.30, Smax' = 0.65 − (0.50 − 0.30)/2 = 0.55
    // G = 0.55 − 0 − √(0.30² + 0.10² + 0.05²) = 0.55 − 0.3202 = 0.2298 → 0.22
    // X = 0.45 + 0 + √(0.10² + 0.10² + 0.05²) = 0.60
    // Pad (1.50 − 0.22)/2 = 0.64 wide, 0.60 high, centres (1.50 + 0.22)/2 = 0.86 apart.
    // G and X agree with the PCB Libraries calculator output in the test above (same KEMET part).
    expectPattern("0402", { width: 0.64, height: 0.6, centres: 0.86 }, 0.005)
  })

  test("0603 follows the cited dimensions and goals", () => {
    // IPC name: CAPC1608 (EIA 0603), density level B.
    // no independent source found
    // KEMET 0603: L 1.45–1.75, W 0.65–0.95, T 0.20–0.50. IPC-7351B Table 3-5 nominal: Jt 0.35, Jh 0,
    // Js 0. F 0.10, P 0.05.
    // Z = 1.45 + 2·0.35 + √(0.30² + 0.10² + 0.05²) = 2.15 + 0.3202 = 2.4702 → 2.48
    // Smin = 1.45 − 2·0.50 = 0.45, Smax = 1.75 − 2·0.20 = 1.35, CS = 0.90
    // CSrms = √(0.30² + 2·0.30²) = 0.5196, Smax' = 1.35 − (0.90 − 0.5196)/2 = 1.1598
    // G = 1.1598 − 0 − √(0.5196² + 0.10² + 0.05²) = 1.1598 − 0.5315 = 0.6283 → 0.62
    // X = 0.65 + 0 + 0.3202 = 0.9702 → 0.98
    // Pad (2.48 − 0.62)/2 = 0.93 wide, 0.98 high, centres (2.48 + 0.62)/2 = 1.55 apart.
    expectPattern("0603", { width: 0.93, height: 0.98, centres: 1.55 }, 0.005)
  })

  test("0805 follows the cited dimensions and goals", () => {
    // IPC name: CAPC2012 (EIA 0805), density level B.
    // no independent source found
    // KEMET 0805: L 1.80–2.20, W 1.05–1.45, T 0.25–0.75. IPC-7351B Table 3-5 nominal: Jt 0.35, Jh 0,
    // Js 0. F 0.10, P 0.05.
    // Z = 1.80 + 2·0.35 + √(0.40² + 0.10² + 0.05²) = 2.50 + 0.4153 = 2.9153 → 2.92
    // Smin = 1.80 − 2·0.75 = 0.30, Smax = 2.20 − 2·0.25 = 1.70, CS = 1.40
    // CSrms = √(0.40² + 2·0.50²) = 0.8124, Smax' = 1.70 − (1.40 − 0.8124)/2 = 1.4062
    // G = 1.4062 − 0 − √(0.8124² + 0.10² + 0.05²) = 1.4062 − 0.8201 = 0.5861 → 0.58
    // X = 1.05 + 0 + 0.4153 = 1.4653 → 1.47
    // Pad (2.92 − 0.58)/2 = 1.17 wide, 1.47 high, centres (2.92 + 0.58)/2 = 1.75 apart.
    expectPattern("0805", { width: 1.17, height: 1.47, centres: 1.75 }, 0.005)
  })

  test("SOD-123 follows the cited dimensions and goals", () => {
    // IPC name: SOD3716X135N, density level B.
    // no independent source found
    // Diodes Inc. SOD123: He 3.55–3.85, L 0.25–0.40, b 0.52–0.62, E 2.55–2.85.
    // IPC-7351B Table 3-2 nominal: Jt 0.35, Js 0.03. Note 1 applies (Smin 2.75 ≤ Amax 2.85 and the
    // terminal tolerance 0.15 is under 0.5), so Jh = 0.15. F 0.10, P 0.05.
    // Z = 3.55 + 2·0.35 + √(0.30² + 0.10² + 0.05²) = 4.25 + 0.3202 = 4.5702 → 4.58
    // Smin = 3.55 − 2·0.40 = 2.75, Smax = 3.85 − 2·0.25 = 3.35, CS = 0.60
    // CSrms = √(0.30² + 2·0.15²) = 0.3674, Smax' = 3.35 − (0.60 − 0.3674)/2 = 3.2337
    // G = 3.2337 − 2·0.15 − √(0.3674² + 0.10² + 0.05²) = 2.9337 − 0.3841 = 2.5496 → 2.54
    // X = 0.52 + 2·0.03 + √(0.10² + 0.10² + 0.05²) = 0.58 + 0.15 = 0.73
    // Pad (4.58 − 2.54)/2 = 1.02 wide, 0.73 high, centres (4.58 + 2.54)/2 = 3.56 apart.
    expectPattern("sod123", { width: 1.02, height: 0.73, centres: 3.56 }, 0.005)
  })
})

describe("every family", () => {
  test.each(FAMILIES)("%s: pads never overlap and the courtyard holds them", (text) => {
    const fp = footprint(text)
    const [one, two] = fp.pads.map(padBox) as [ReturnType<typeof padBox>, ReturnType<typeof padBox>]
    expect(two.minX - one.maxX).toBeGreaterThan(0)
    const xs = fp.courtyard.map((p) => p.x)
    const ys = fp.courtyard.map((p) => p.y)
    const court = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
    for (const pad of fp.pads.map(padBox)) {
      expect(pad.minX - court.minX).toBeGreaterThanOrEqual(0.25 - EPS)
      expect(court.maxX - pad.maxX).toBeGreaterThanOrEqual(0.25 - EPS)
      expect(pad.minY - court.minY).toBeGreaterThanOrEqual(0.25 - EPS)
      expect(court.maxY - pad.maxY).toBeGreaterThanOrEqual(0.25 - EPS)
    }
  })

  test.each(FAMILIES)("%s: pad 1 is on the left", (text) => {
    const pads = footprint(text).pads
    expect(pads[0]?.number).toBe("1")
    expect(pads[0]?.x).toBeLessThan(0)
    expect(pads[1]?.number).toBe("2")
    expect(pads[1]?.x).toBeGreaterThan(0)
  })

  test.each(FAMILIES)("%s: pads are top-side round rectangles", (text) => {
    for (const pad of footprint(text).pads) {
      expect(pad.shape).toBe("roundrect")
      expect(pad.layers).toBe("top")
      expect(pad.rotation).toBe(0)
      expect(pad.y).toBe(0)
      expect(pad.cornerRadius).toBeCloseTo(Math.min(0.25, 0.25 * Math.min(pad.width, pad.height)), 9)
    }
  })

  test.each(FAMILIES)("%s: silkscreen keeps 0.15 mm away from pads", (text) => {
    const fp = footprint(text)
    expect(fp.silkscreen.length).toBeGreaterThanOrEqual(2)
    for (const [a, b] of segments(fp.silkscreen)) {
      for (const pad of fp.pads) expect(segmentToBox(a, b, padBox(pad))).toBeGreaterThanOrEqual(0.15 - 1e-6)
    }
  })

  test.each(FAMILIES)("%s: the fabrication layer outlines the body", (text) => {
    const fp = footprint(text)
    expect(fp.fabrication.length).toBeGreaterThanOrEqual(1)
    expect(fp.origin).toMatch(/^IPC-7351B nominal, /)
    expect(fp.name).toBe(text)
  })
})

test("chips get two lines along the body and SOD gets a cathode bar at pad 2", () => {
  const chip = footprint("0603")
  expect(chip.silkscreen).toHaveLength(2)
  for (const line of chip.silkscreen) expect(new Set(line.map((p) => p.y)).size).toBe(1)

  for (const text of ["sod123", "sod323", "sod523"]) {
    const vertical = footprint(text).silkscreen.filter((line) => new Set(line.map((p) => p.x)).size === 1)
    expect(vertical).toHaveLength(1)
    expect(vertical[0]?.[0]?.x).toBeGreaterThan(0)
  }
})

describe("gull-wing heel goal (IPC-7351B Table 3-2, Notes 1 and 2)", () => {
  const body = { min: 2.55, max: 2.85 }
  test("leads whose heels can reach under the body get the Note 1 heel", () => {
    const lead = { span: { min: 3.55, max: 3.85 }, terminal: { min: 0.25, max: 0.4 }, width: { min: 0.52, max: 0.62 } }
    expect(gullWingGoals(lead, body)).toEqual({ toe: 0.35, heel: 0.15, side: 0.03 })
  })
  test("leads that end outside the body keep the table heel", () => {
    const lead = { span: { min: 4.0, max: 4.2 }, terminal: { min: 0.3, max: 0.5 }, width: { min: 0.3, max: 0.4 } }
    expect(gullWingGoals(lead, body)).toEqual({ toe: 0.35, heel: 0.35, side: 0.03 })
  })
  test("Note 2: a terminal tolerance over 0.5 mm keeps the table heel", () => {
    const lead = { span: { min: 5.8, max: 6.2 }, terminal: { min: 0.4, max: 1.27 }, width: { min: 0.31, max: 0.51 } }
    expect(gullWingGoals(lead, { min: 3.8, max: 4.0 })).toEqual({ toe: 0.35, heel: 0.35, side: 0.03 })
  })
})

test("a land pattern without a gap is refused", () => {
  expect(() => twoTerminalPads({ Z: 1, G: 0.004, X: 0.5 })).toThrow(/no gap/)
})

test("a cathode bar moves outside pad 2 when the gap is too narrow", () => {
  const pads = twoTerminalPads({ Z: 1.2, G: 0.2, X: 0.5 })
  const bar = cathodeBar(pads, { x: 0.4, y: 0.2 })
  expect(bar.map((p) => p.x)).toEqual([0.75, 0.75])
  expect(bar.map((p) => p.y)).toEqual([-0.4, 0.4])
})

test("a pad turned a quarter turn swaps its width and height in the extent", () => {
  const [pad] = twoTerminalPads({ Z: 2, G: 1, X: 0.4 })
  expect(padExtent([{ ...pad!, rotation: 90 }])).toEqual({ x: 0.75 + 0.2, y: 0.25 })
})

test("origin names the package", () => {
  expect(footprint("0603").origin).toBe("IPC-7351B nominal, EIA 0603")
  expect(footprint("sod123").origin).toBe("IPC-7351B nominal, SOD-123")
})

test("padCount", () => {
  expect(padCount("0603")).toBe(2)
  expect(padCount("sod123")).toBe(2)
  expect(padCount("bga64")).toBeUndefined()
})

test("unknown strings are refused", () => {
  expect(generateFootprint("bga64")).toEqual({ error: 'copperflow cannot make footprint "bga64" yet' })
  expect(generateFootprint("0604")).toEqual({ error: 'copperflow cannot make footprint "0604" yet' })
  expect(generateFootprint("0603_p0.5mm")).toEqual({ error: 'copperflow cannot make footprint "0603_p0.5mm" yet' })
  expect(generateFootprint("")).toEqual({ error: 'copperflow cannot make footprint "" yet' })
  expect(generateFootprint("sod999")).toEqual({ error: 'copperflow cannot make footprint "sod999" yet' })
  expect(generateFootprint("sod123_w2")).toEqual({ error: 'copperflow cannot make footprint "sod123_w2" yet' })
})

test("results are cached by text and cannot be changed", () => {
  const first = footprint("0805")
  expect(footprint("0805")).toBe(first)
  expect(Object.isFrozen(first)).toBe(true)
  expect(Object.isFrozen(first.pads[0])).toBe(true)
  expect(Object.isFrozen(first.courtyard[0])).toBe(true)
})

test("footprint strings split into a kind, a code and parameters", () => {
  expect(parseFootprint("0603")).toEqual({ kind: "", code: "0603", params: {} })
  expect(parseFootprint("SOD123")).toEqual({ kind: "sod", code: "123", params: {} })
  expect(parseFootprint("soic8_w5.3mm_p1.27")).toEqual({ kind: "soic", code: "8", params: { w: 5.3, p: 1.27 } })
  expect(parseFootprint("pinrow4_p100mil")?.params.p).toBeCloseTo(2.54, 9)
  expect(parseFootprint("pinrow4_male")).toEqual({ kind: "pinrow", code: "4", params: { male: true } })
  expect(parseFootprint("")).toBeUndefined()
  expect(parseFootprint("0603_")).toBeUndefined()
  expect(parseFootprint("soic8_w5x")).toBeUndefined()
  expect(parseFootprint("soic8_p1_p2")).toBeUndefined()
  expect(parseFootprint("so ic8")).toBeUndefined()
})
