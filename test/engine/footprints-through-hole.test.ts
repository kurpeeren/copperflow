import { describe, expect, test } from "vitest"
import { padCount } from "../../src/engine/footprints/index.js"
import { leadDiameter, throughHoleLand } from "../../src/engine/footprints/ipc7251.js"
import type { Footprint } from "../../src/engine/footprints/types.js"
import { courtyardHalf, expectWellFormed, footprint, neighbourDistances, pad, refusedAll } from "./footprint-checks.js"

const drill = (fp: Footprint, n: number | string) => pad(fp, n).drill?.width

/** The pin 1 tick: a horizontal silkscreen line centred under pad 1. */
function expectTickUnderPadOne(fp: Footprint) {
  const p1 = pad(fp, 1)
  const tick = fp.silkscreen.find((line) => line.length === 2 && line[0]?.y === line[1]?.y && Math.abs(((line[0]?.x ?? 0) + (line[1]?.x ?? 0)) / 2 - p1.x) < 1e-9)
  expect(tick, `${fp.name} has a tick under pad 1`).toBeDefined()
  expect(tick?.[0]?.y).toBeLessThan(p1.y - p1.height / 2)
}

describe("through-hole lands", () => {
  test("hole = lead + 0.20, land = hole + 0.60, both rounded up to 0.05", () => {
    // DIP lead 0.56 × 0.36: diagonal 0.6657 + 0.20 = 0.8657 → 0.90; 0.90 + 0.60 = 1.50.
    expect(throughHoleLand(leadDiameter({ min: 0.36, max: 0.56 }, { min: 0.2, max: 0.36 }))).toEqual({ drill: 0.9, pad: 1.5 })
    // Round lead 0.46: 0.66 → 0.70; 1.30.
    expect(throughHoleLand(leadDiameter({ min: 0.4, max: 0.46 }))).toEqual({ drill: 0.7, pad: 1.3 })
  })
})

describe("DIP", () => {
  test("DIP-8: 300 mil rows, pin 1 at the top left, counter-clockwise", () => {
    const fp = footprint("dip8")
    expect(fp.pads).toHaveLength(8)
    expect(pad(fp, 1)).toMatchObject({ x: -3.81, y: 3.81, shape: "rect", layers: "through", width: 1.5 })
    expect(pad(fp, 4)).toMatchObject({ x: -3.81, y: -3.81, shape: "circle" })
    expect(pad(fp, 5)).toMatchObject({ x: 3.81, y: -3.81 })
    expect(pad(fp, 8)).toMatchObject({ x: 3.81, y: 3.81 })
    expect(drill(fp, 1)).toBe(0.9)
    for (const d of neighbourDistances(fp, 4)) expect(d).toBeCloseTo(2.54, 9)
    // Body 6.35 × 10.16; courtyard: pads reach 3.81 + 0.75 = 4.56 → 4.85; body 5.08 → 5.35.
    expect(courtyardHalf(fp)).toEqual({ x: 4.85, y: 5.35 })
    expectWellFormed(fp)
  })

  test("the notch at the top of the outline marks pin 1's end", () => {
    const fp = footprint("dip8")
    const outline = fp.silkscreen[0] ?? []
    const top = Math.max(...outline.map((p) => p.y))
    const notch = outline.filter((p) => p.y < top - 0.5 && Math.abs(p.x) < 1)
    expect(notch.length).toBeGreaterThan(0)
    expect(Math.min(...notch.map((p) => p.y))).toBeCloseTo(top - 0.75, 6)
  })

  test("_w sets the row spacing", () => {
    const fp = footprint("dip28_w15.24")
    expect(pad(fp, 1)).toMatchObject({ x: -7.62, y: 16.51 })
    expect(pad(fp, 28)).toMatchObject({ x: 7.62, y: 16.51 })
    expect(fp.name).toBe("dip28_w15.24")
    expect(footprint("dip8_w7.62mm").name).toBe("dip8")
    expect(footprint("dip8_w300mil").pads).toEqual(footprint("dip8").pads)
    expectWellFormed(fp)
  })

  test("others are refused", () => {
    refusedAll({
      "dip7": "a DIP has an even pin count from 4 to 64",
      "dip2": "a DIP has an even pin count from 4 to 64",
      "dip66": "a DIP has an even pin count from 4 to 64",
      "dip8_w5": "DIP rows are at least 7.62 mm apart",
      "dip8_p2": "a DIP takes only _w, not _p",
      "dip8_5": null,
      "dip8s": null,
    })
  })
})

describe("TO-220 and TO-92", () => {
  test("TO-220: three leads 2.54 apart, pad 1 square at the left, tab at the back", () => {
    // Lead 0.90 × 0.60: diagonal 1.0817 + 0.20 → 1.30 hole; 1.90 land.
    const fp = footprint("to220")
    expect(fp.pads.map((p) => [p.number, p.x, p.y])).toEqual([
      ["1", -2.54, 0],
      ["2", 0, 0],
      ["3", 2.54, 0],
    ])
    expect(pad(fp, 1)).toMatchObject({ shape: "rect", width: 1.9 })
    expect(drill(fp, 2)).toBe(1.3)
    expectWellFormed(fp)
    expectTickUnderPadOne(fp)
    // The lead plane is 2.0 behind the front face and 2.5 in front of the tab's back; the tab is 1.27 thick.
    const outline = fp.silkscreen[0] ?? []
    expect(Math.min(...outline.map((p) => p.y))).toBe(-2)
    expect(Math.max(...outline.map((p) => p.y))).toBe(2.5)
    expect(fp.silkscreen[1]?.[0]?.y).toBeCloseTo(1.23, 9)
    // Courtyard: 2.5 + 0.25 = 2.75 front and back.
    expect(courtyardHalf(fp).y).toBe(2.75)
  })

  test("TO-92: leads formed to 2.54, the flat face in front", () => {
    const fp = footprint("to92")
    expect(fp.pads.map((p) => p.x)).toEqual([-2.54, 0, 2.54])
    expect(drill(fp, 1)).toBe(0.95)
    expect(pad(fp, 3).width).toBe(1.55)
    expectWellFormed(fp)
    expectTickUnderPadOne(fp)
  })

  test("others are refused", () => {
    refusedAll({
      "to220_p2.54": null,
      "to221": null,
      "to92s": null,
      "to92_5": null,
      "to247_3": "TO-247 has three leads and takes no variant",
      "to126_2": "TO-126 has three leads and takes no variant",
      "to220_4": "TO-220 comes as to220 (3 leads), to220_2 or to220_5",
      "to248": null,
      "to92_inline_3": null,
    })
  })
})

describe("crystals", () => {
  test("HC-49/S: two leads 4.88 apart, 0.70 holes", () => {
    const fp = footprint("hc49s")
    expect(fp.pads.map((p) => [p.number, p.x, p.y])).toEqual([
      ["1", -2.44, 0],
      ["2", 2.44, 0],
    ])
    expect(pad(fp, 1)).toMatchObject({ shape: "rect", width: 1.3 })
    expect(drill(fp, 2)).toBe(0.7)
    // Courtyard: case 5.525 + 0.25 → 5.80, 2.325 + 0.25 → 2.60.
    expect(courtyardHalf(fp)).toEqual({ x: 5.8, y: 2.6 })
    expect(fp.origin).toContain("HC-49/S")
    expectWellFormed(fp)
    expectTickUnderPadOne(fp)
  })

  test("hc49 has the same pads", () => {
    expect(footprint("hc49").pads).toEqual(footprint("hc49s").pads)
    expect(footprint("hc49").origin).toContain("HC-49/U")
    refusedAll({
      "hc49u": null,
      "hc50": null,
      "hc49_p5": null,
      "hc49s_5": null,
    })
  })
})

describe("radial electrolytics", () => {
  test("radial5x2: leads 2 mm apart in a 5 mm can, pad 1 positive with a + beside it", () => {
    const fp = footprint("radial5x2")
    expect(fp.pads.map((p) => [p.number, p.x, p.shape])).toEqual([
      ["1", -1, "rect"],
      ["2", 1, "circle"],
    ])
    expect(drill(fp, 1)).toBe(0.7)
    const plus = fp.silkscreen.slice(1)
    expect(plus).toHaveLength(2)
    for (const line of plus) for (const p of line) expect(Math.abs(p.x - pad(fp, 1).x)).toBeLessThanOrEqual(0.4 + 1e-9)
    expectWellFormed(fp)
  })

  test.each(["radial4x1.5", "radial6.3x2.5", "radial8x3.5", "radial10x5", "radial12.5x5", "radial16x7.5"])("%s is well formed", (text) => {
    expectWellFormed(footprint(text))
  })

  test("larger cans have thicker leads", () => {
    expect(drill(footprint("radial6.3x2.5"), 1)).toBe(0.7)
    expect(drill(footprint("radial10x5"), 1)).toBe(0.85)
    expect(drill(footprint("radial12.5x5"), 1)).toBe(1.05)
  })

  test("others are refused", () => {
    refusedAll({
      "radial5": "a radial capacitor is radial<can diameter>x<lead spacing>, such as radial6.3x2.5",
      "radial5x5": "the leads must be closer together than the 5 mm can is wide",
      "radial6.3x7": "the leads must be closer together than the 6.3 mm can is wide",
      "radial5x1": "1.3 mm lands 1 mm apart would touch",
      "radial2x1": "the can is 3 to 40 mm across",
      "radial50x10": "the can is 3 to 40 mm across",
      "radial5x2_p2": null,
      "radial5x2s": null,
    })
  })
})

describe("two-row pin headers", () => {
  test("pinrow2x5: odd pins along the top, even along the bottom, pin 1 at the top left", () => {
    const fp = footprint("pinrow2x5")
    expect(fp.pads).toHaveLength(10)
    expect(pad(fp, 1)).toMatchObject({ x: -5.08, y: 1.27, shape: "rect" })
    expect(pad(fp, 2)).toMatchObject({ x: -5.08, y: -1.27, shape: "circle" })
    expect(pad(fp, 3)).toMatchObject({ x: -2.54, y: 1.27 })
    expect(pad(fp, 10)).toMatchObject({ x: 5.08, y: -1.27 })
    expect(fp.name).toBe("pinrow2x5_p2.54mm")
    expect(padCount("pinrow2x20")).toBe(40)
    expectWellFormed(fp)
  })

  test("a tick left of the outline marks pin 1", () => {
    const fp = footprint("pinrow2x3_p2mm")
    const tick = fp.silkscreen[1] ?? []
    expect(tick).toHaveLength(2)
    expect(tick[0]?.x).toBe(tick[1]?.x)
    expect(tick[0]?.x).toBeLessThan(pad(fp, 1).x)
    expect(Math.min(...tick.map((p) => p.y))).toBeGreaterThan(0)
  })

  test("others are refused", () => {
    refusedAll({
      "pinrow3x5": "headers have one row (pinrow<N>) or two (pinrow2x<N>)",
      "pinrow2x0": "a two-row header has 1 to 500 pins a row",
      "pinrow2x5_p1.5": null,
      "pinrow2x5s": null,
      "pinrow2x5_w3": null,
    })
  })
})
