import { describe, expect, it } from "vitest"
import { microstrip, microstripPair, pairGapFor, pairWidthFor, pairPlan, widthFor } from "../src/engine/impedance.js"

/**
 * Steer, "Fundamentals of Microwave and RF Design", section 4.4, Table 4.4.1 (normalized width u = w/h for a given
 * Z0, zero-thickness strip), https://eng.libretexts.org/Bookshelves/Electrical_Engineering/Electronics/Fundamentals_of_Microwave_and_RF_Design_(Steer)/04%3A_Planar_Transmission_Lines/4.04%3A_Microstrip_Transmission_Lines
 */
const TABLE: [z0: number, er: number, u: number][] = [
  [140, 4, 0.171],
  [100, 4, 0.494],
  [75, 4, 0.976],
  [50, 4, 2.056],
  [30, 4, 4.364],
  [20, 4, 7.341],
  [120, 10, 0.061],
  [50, 10, 0.954],
  [25, 10, 3.087],
]

describe("surface microstrip (Hammerstad and Jensen)", () => {
  for (const h of [0.2, 1.6]) {
    for (const [z0, er, u] of TABLE) {
      it(`gives ${z0} ohm at w/h ${u}, er ${er}, h ${h} mm, within 0.5 %`, () => {
        const got = microstrip({ width: u * h, height: h, permittivity: er, thickness: 0 }).impedance
        expect(Math.abs(got - z0) / z0).toBeLessThan(0.005)
      })
    }
  }

  it("inverts: the width for 50 ohm on er 4 is the table's within 1 %", () => {
    const got = widthFor(50, { height: 1, permittivity: 4, thickness: 0 }).width
    expect(Math.abs(got - 2.056) / 2.056).toBeLessThan(0.01)
  })

  it("copper thickness lowers the impedance a little", () => {
    const thin = microstrip({ width: 0.3, height: 0.2, permittivity: 4.6, thickness: 0 }).impedance
    const thick = microstrip({ width: 0.3, height: 0.2, permittivity: 4.6, thickness: 0.035 }).impedance
    expect(thick).toBeLessThan(thin)
    expect(thin - thick).toBeLessThan(5)
  })

  it("warns outside the equations' range", () => {
    expect(microstrip({ width: 0.001, height: 1.6, permittivity: 4.6, thickness: 0 }).warning).toMatch(/outside/)
    expect(microstrip({ width: 0.3, height: 0.2, permittivity: 4.6, thickness: 0.035 }).warning).toBeUndefined()
  })
})

describe("edge-coupled surface microstrip pair (IPC-2141A coupling)", () => {
  const stack = { height: 1.53, permittivity: 4.6, thickness: 0.035 }
  it("is twice the single line when far apart and less when close", () => {
    const single = microstrip({ width: 0.5, ...stack }).impedance
    expect(microstripPair({ width: 0.5, gap: 20, ...stack }).impedance).toBeCloseTo(2 * single, 3)
    expect(microstripPair({ width: 0.5, gap: 0.2, ...stack }).impedance).toBeLessThan(2 * single)
  })
  it("inverts for width and for gap", () => {
    const w = pairWidthFor(100, 0.2, stack).width
    expect(microstripPair({ width: w, gap: 0.2, ...stack }).impedance).toBeCloseTo(100, 1)
    const g = pairGapFor(100, 0.8, stack).gap
    expect(g).toBeDefined()
    expect(microstripPair({ width: 0.8, gap: g as number, ...stack }).impedance).toBeCloseTo(100, 1)
  })
  it("says plainly when a pair is not practical on the board", () => {
    const plan = pairPlan(90, { ...stack, boardThickness: 1.6 }, { minGap: 0.1, minWidth: 0.1 }, undefined, 0.8)
    expect(plan.practical).toBe(false)
    expect(plan.text).toMatch(/^90 ohm differential needs a 0\.0\d+ mm gap at 0\.8 mm width on a 1\.6 mm board, under the profile's smallest gap: use a thinner board or accept the mismatch on a short run$/)
    const thin = pairPlan(200, { height: 0.2, permittivity: 4.6, thickness: 0.035, boardThickness: 0.2 }, { minGap: 0.1, minWidth: 0.1 }, 0.2)
    expect(thin.practical).toBe(false)
    expect(thin.text).toMatch(/^200 ohm differential needs a 0\.2 mm gap at 0\.0\d+ mm width on a 0\.2 mm board, under the profile's smallest width: /)
  })
  it("plans a practical 90 ohm pair at the default gap", () => {
    const plan = pairPlan(90, { ...stack, boardThickness: 1.6 }, { minGap: 0.1, minWidth: 0.1 }, 0.2)
    expect(plan.practical).toBe(true)
    expect(plan.gap).toBe(0.2)
    expect(plan.width).toBeGreaterThan(0.5)
  })
})
