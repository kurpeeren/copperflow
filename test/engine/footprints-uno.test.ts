// The parts an Arduino Uno needs that are not JEDEC packages: resonator, USB-B and USB-C receptacles, DC jack,
// tact switches and shielded power inductors. Values are the cited makers' drawings (see each module).
import { describe, expect, test } from "vitest"
import type { Footprint } from "../../src/engine/footprints/types.js"
import { expectWellFormed, footprint, pad, refusedAll } from "./footprint-checks.js"

const numbers = (fp: Footprint) => fp.pads.map((p) => p.number)
const fabMinY = (fp: Footprint) => Math.min(...fp.fabrication.flat().map((p) => p.y))

describe("ceramic resonator", () => {
  test("resonator3213: three pads in a row 1.2 apart, pad 2 the middle", () => {
    const fp = footprint("RESONATOR3213")
    expect(numbers(fp)).toEqual(["1", "2", "3"])
    expect([pad(fp, 1).x, pad(fp, 2).x, pad(fp, 3).x]).toEqual([-1.2, 0, 1.2])
    expect(pad(fp, 1)).toMatchObject({ width: 0.4, height: 1.9, layers: "top" })
    expect(fp.origin).toContain("typical")
    expectWellFormed(fp)
  })
})

describe("USB Type-B receptacle (Würth 61400416121)", () => {
  const fp = footprint("usb_b")
  test("four signal pins and the shell legs as a shared pad 5", () => {
    expect(numbers(fp)).toEqual(["1", "2", "3", "4", "5", "5"])
    expect(pad(fp, 1).shape).toBe("rect")
    expect(pad(fp, 1).drill).toEqual({ width: 0.92, height: 0.92 })
    expect(pad(fp, 1).width).toBe(1.55)
    const shell = fp.pads.filter((p) => p.number === "5")
    expect(shell.map((p) => p.drill?.width)).toEqual([2.3, 2.3])
    expect(shell[1]!.x - shell[0]!.x).toBeCloseTo(12.04, 9)
    expectWellFormed(fp)
  })

  test("hole pattern: pins 1 and 2 2.5 apart at the rear, 3 and 4 2 nearer the plug, shell 2.71 nearer still", () => {
    expect(pad(fp, 1).x - pad(fp, 2).x).toBeCloseTo(2.5, 9)
    expect(pad(fp, 4).x).toBeCloseTo(pad(fp, 1).x, 9)
    expect(pad(fp, 1).y - pad(fp, 4).y).toBeCloseTo(2, 9)
    expect(pad(fp, 4).y - fp.pads[4]!.y).toBeCloseTo(2.71, 9)
    expect(fp.pads[4]!.y - fabMinY(fp)).toBeCloseTo(10.28, 9)
    expect(fp.origin).toContain("Würth Elektronik 61400416121")
  })
})

describe("USB Type-C receptacle, 16 pins (Würth 629722000214)", () => {
  const fp = footprint("usb_c16")
  test("twelve surface pads left to right and four shell slots numbered 13", () => {
    expect(numbers(fp)).toEqual([...Array.from({ length: 12 }, (_, i) => String(i + 1)), "13", "13", "13", "13"])
    expect(fp.pads.slice(0, 12).map((p) => p.x)).toEqual([-3.2, -2.4, -1.75, -1.25, -0.75, -0.25, 0.25, 0.75, 1.25, 1.75, 2.4, 3.2])
    expect(fp.pads.slice(0, 12).map((p) => p.width)).toEqual([0.6, 0.6, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.6, 0.6])
    expect(pad(fp, 1).height).toBe(1.15)
    const shell = fp.pads.slice(12)
    expect(shell.map((p) => [p.drill?.width, p.drill?.height])).toEqual([[0.6, 1.7], [0.6, 1.7], [0.6, 1.4], [0.6, 1.4]])
    expect(shell[1]!.x - shell[0]!.x).toBeCloseTo(8.64, 9)
    expect(shell[0]!.y - shell[2]!.y).toBeCloseTo(4.18, 9)
    expect(shell[2]!.y - fabMinY(fp)).toBeCloseTo(2.62, 9)
    expect(pad(fp, 1).y + 0.575 - shell[2]!.y).toBeCloseTo(5.32, 9)
    expectWellFormed(fp)
  })
})

describe("DC barrel jack (Würth 694106301002)", () => {
  test.each(["dcjack", "dcjack2.1", "DCJACK2.5"])("%s: three slotted terminals", (text) => {
    const fp = footprint(text)
    expect(fp.name).toBe("dcjack")
    expect(numbers(fp)).toEqual(["1", "2", "3"])
    expect(pad(fp, 1).drill).toEqual({ width: 3.2, height: 0.7 })
    expect(pad(fp, 2).drill).toEqual({ width: 2.8, height: 0.7 })
    expect(pad(fp, 3).drill).toEqual({ width: 0.7, height: 2.8 })
    expect(pad(fp, 1).y - fabMinY(fp)).toBeCloseTo(13.5, 9)
    expect(pad(fp, 3).y - fabMinY(fp)).toBeCloseTo(10.55, 9)
    expect(pad(fp, 2).y - fabMinY(fp)).toBeCloseTo(7.7, 9)
    expect(pad(fp, 3).x - pad(fp, 1).x).toBeCloseTo(4.8, 9)
    expectWellFormed(fp)
  })
})

describe("tact switches 6 × 6", () => {
  test("tact6x6: 1.0 mm holes 6.5 × 4.5 apart, 1 and 2 along the top", () => {
    const fp = footprint("tact6x6")
    expect(numbers(fp)).toEqual(["1", "2", "3", "4"])
    expect(pad(fp, 2).x - pad(fp, 1).x).toBeCloseTo(6.5, 9)
    expect(pad(fp, 1).y - pad(fp, 3).y).toBeCloseTo(4.5, 9)
    expect(pad(fp, 1)).toMatchObject({ shape: "rect", width: 1.6, drill: { width: 1 } })
    expectWellFormed(fp)
  })

  test("tact6x6_smd: 1.55 × 1.3 lands, 6.4 between and 9.5 over them", () => {
    const fp = footprint("tact6x6_smd")
    expect(numbers(fp)).toEqual(["1", "2", "3", "4"])
    expect(pad(fp, 1)).toMatchObject({ width: 1.55, height: 1.3, layers: "top" })
    expect(pad(fp, 2).x - pad(fp, 1).x - 1.55).toBeCloseTo(6.4, 9)
    expect(pad(fp, 2).x - pad(fp, 1).x + 1.55).toBeCloseTo(9.5, 9)
    expect(pad(fp, 1).y - pad(fp, 3).y).toBeCloseTo(4.5, 9)
    expectWellFormed(fp)
  })
})

describe("shielded power inductors", () => {
  test.each(["ind4x4", "ind5x5", "ind6x6", "ind8x8", "ind10x10", "ind12x12"])("%s: two pads, typical", (text) => {
    const fp = footprint(text)
    expect(numbers(fp)).toEqual(["1", "2"])
    expect(pad(fp, 1).x).toBeLessThan(0)
    expect(fp.origin).toContain("typical")
    expectWellFormed(fp)
  })
})

test("near misses are refused", () => {
  const sizes = "known shielded power inductor sizes are 4x4, 5x5, 6x6, 8x8, 10x10, 12x12"
  refusedAll({
    ind7x7: sizes,
    ind4x5: sizes,
    tact6x6_tht: "tact switches are tact6x6 (through-hole) and tact6x6_smd",
    tact12x12: "tact switches are tact6x6 (through-hole) and tact6x6_smd",
    dcjack3: "dcjack, dcjack2.1 and dcjack2.5 are one footprint (5.5 mm sleeve, 2.0/2.1 mm pin); no other",
    usb_a: "USB receptacles are usb_b and usb_c16",
    usb_c24: "USB receptacles are usb_b and usb_c16",
    resonator2012: "the ceramic resonator is resonator3213",
  })
})
