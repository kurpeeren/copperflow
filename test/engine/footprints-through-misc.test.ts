import { describe, expect, test } from "vitest"
import { axialFootprint } from "../../src/engine/footprints/axial.js"
import { ledSmdFootprint } from "../../src/engine/footprints/ledsmd.js"
import { ledThroughHoleFootprint } from "../../src/engine/footprints/ledth.js"
import { parseFootprint } from "../../src/engine/footprints/parse.js"
import { pinRowFootprint } from "../../src/engine/footprints/pinrow.js"
import { screwFootprint } from "../../src/engine/footprints/screw.js"
import { smdCanFootprint } from "../../src/engine/footprints/smdcan.js"
import { socketFootprint } from "../../src/engine/footprints/socket.js"
import { isRefusal, type Footprint, type Refusal } from "../../src/engine/footprints/types.js"
import { xtalFootprint } from "../../src/engine/footprints/xtal.js"
import { expectWellFormed, neighbourDistances, pad } from "./footprint-checks.js"

// These families are not registered in index.ts yet, so they are tried here directly, in order.
const FAMILIES = [axialFootprint, ledThroughHoleFootprint, screwFootprint, socketFootprint, smdCanFootprint, xtalFootprint, ledSmdFootprint]

function attempt(text: string): Footprint | Refusal | undefined {
  const parsed = parseFootprint(text)
  if (!parsed) return undefined
  for (const family of FAMILIES) {
    const result = family(parsed)
    if (result) return result
  }
  return undefined
}

function make(text: string): Footprint {
  const result = attempt(text)
  if (!result || isRefusal(result)) throw new Error(`${text}: ${result ? result.refused : "not recognised"}`)
  return result
}

function refusedWith(text: string, fragment: string): void {
  const result = attempt(text)
  expect(result && isRefusal(result), text).toBe(true)
  expect((result as Refusal).refused).toContain(fragment)
}

const notMine = (text: string) => expect(attempt(text), text).toBeUndefined()

const numbers = (fp: Footprint) => fp.pads.map((p) => p.number)

describe("axial parts", () => {
  test.each(["axial6.3x10.16", "axial3.6x7.62", "axial9x12.7_d3.3", "do35", "do41", "do15", "do201ad", "AXIAL6.3X10.16"])("%s is well formed", (text) => {
    const fp = make(text)
    expect(fp.pads).toHaveLength(2)
    expect(numbers(fp)).toEqual(["1", "2"])
    expectWellFormed(fp)
  })

  test("a quarter-watt resistor: 10.16 mm spacing, 0.65 mm lead → 0.85 mm hole, 1.45 mm land, diameter from the table", () => {
    const fp = make("axial6.3x10.16")
    expect(pad(fp, 2).x - pad(fp, 1).x).toBeCloseTo(10.16, 9)
    expect(pad(fp, 1)).toMatchObject({ shape: "rect", width: 1.45, drill: { width: 0.85 } })
    expect(Math.max(...fp.fabrication.flat().map((p) => p.y))).toBeCloseTo(1.25, 9)
    expect(make("axial6.3x10.16_d2").fabrication.flat().some((p) => p.y === 1)).toBe(true)
  })

  test("named diodes: spacing, pad 1 anode, a cathode bar nearer pad 2", () => {
    const spacing = { do35: 7.62, do41: 10.16, do15: 12.7, do201ad: 15.24 }
    for (const [text, pitch] of Object.entries(spacing)) {
      const fp = make(text)
      expect(pad(fp, 2).x - pad(fp, 1).x).toBeCloseTo(pitch, 9)
      expect(fp.origin).toContain("pad 1 anode")
      const bars = fp.silkscreen.filter((line) => line.length === 2 && line[0]?.x === line[1]?.x && (line[0]?.x ?? 0) > 0)
      expect(bars.length, text).toBe(1)
    }
    expect(pad(make("do201ad"), 1).drill?.width).toBe(1.5)
  })

  test("refusals and strings that are not axial", () => {
    refusedWith("axial6.3x7.62", "at least 9.3 mm")
    refusedWith("axial6.3", "axial<body length>x<lead spacing>")
    refusedWith("axial0.5x5", "1 to 30 mm long")
    notMine("do214ac")
    notMine("do36")
    notMine("axial6.3x10.16_p2")
  })
})

describe("through-hole LEDs", () => {
  test.each(["led3mm", "led5mm"])("%s: two pads 2.54 apart, pad 1 anode square, flat on the cathode side", (text) => {
    const fp = make(text)
    expect(numbers(fp)).toEqual(["1", "2"])
    expect(pad(fp, 2).x - pad(fp, 1).x).toBeCloseTo(2.54, 9)
    expect(pad(fp, 1).shape).toBe("rect")
    const maxX = Math.max(...fp.fabrication.flat().map((p) => p.x))
    const minX = Math.min(...fp.fabrication.flat().map((p) => p.x))
    expect(maxX).toBeLessThan(-minX - 0.2)
    expectWellFormed(fp)
  })

  test("square 0.55 mm leads: 0.78 diagonal → 1.0 mm hole, 1.6 mm land", () => {
    expect(pad(make("led5mm"), 2)).toMatchObject({ width: 1.6, drill: { width: 1 } })
    notMine("led4mm")
  })
})

describe("screw terminal blocks", () => {
  test.each(["screw2", "screw3_p3.5", "screw24_p3.81", "screw12_p5", "screw4_p5.08mm"])("%s is well formed", (text) => {
    expectWellFormed(make(text))
  })

  test("poles, pitch and the 1 mm square pin land: 1.48 diagonal → 1.7 mm hole, 2.3 mm land", () => {
    const fp = make("screw3")
    expect(numbers(fp)).toEqual(["1", "2", "3"])
    for (const d of neighbourDistances(fp, 3)) expect(d).toBeCloseTo(5.08, 9)
    expect(pad(fp, 1)).toMatchObject({ shape: "rect", width: 2.3, drill: { width: 1.7 } })
    for (const d of neighbourDistances(make("screw4_p3.5"), 4)) expect(d).toBeCloseTo(3.5, 9)
  })

  test("refusals", () => {
    refusedWith("screw2_p2.54", "3.5, 3.81, 5, 5.08 mm pitch")
    refusedWith("screw1", "2 to 24 poles")
    refusedWith("screw25", "2 to 24 poles")
  })
})

describe("pin sockets", () => {
  test("the pads of the pin row they mirror, named socket", () => {
    for (const [socket, row] of [["socket4", "pinrow4"], ["socket2x5", "pinrow2x5"], ["socket1", "pinrow1"]] as const) {
      const fp = make(socket)
      const rowFp = pinRowFootprint(parseFootprint(row)!) as Footprint
      expect(fp.pads).toEqual(rowFp.pads)
      expect(fp.name).toBe(socket)
      expect(fp.origin).toContain("socket")
      expectWellFormed(fp)
    }
  })

  test("refusals", () => {
    refusedWith("socket4_p2", "2.54 mm pitch only")
    refusedWith("socket3x4", "socket<N>")
  })
})

describe("surface-mount electrolytic cans", () => {
  const sizes = ["4x5.4", "5x5.4", "6.3x5.4", "6.3x7.7", "8x6.5", "8x10.2", "10x10.2"]
  test.each(sizes)("smdcan%s is well formed", (size) => {
    const fp = make(`smdcan${size}`)
    expect(numbers(fp)).toEqual(["1", "2"])
    expect(pad(fp, 1).x).toBeLessThan(0)
    expectWellFormed(fp)
  })

  test("Nichicon CAT.8100N lands: 6.3 mm 3.5 × 1.6 pads 1.9 apart, 10 mm 4.0 × 2.5 pads 4.0 apart", () => {
    const small = make("smdcan6.3x5.4")
    expect(pad(small, 1)).toMatchObject({ width: 3.5, height: 1.6 })
    expect(pad(small, 2).x - pad(small, 2).width / 2 - (pad(small, 1).x + pad(small, 1).width / 2)).toBeCloseTo(1.9, 9)
    const large = make("smdcan10x10.2")
    expect(pad(large, 2)).toMatchObject({ x: 4, width: 4, height: 2.5 })
  })

  test("other sizes are refused, naming the known ones", () => {
    refusedWith("smdcan6.3x6", "4x5.4, 5x5.4, 6.3x5.4")
    refusedWith("smdcan6.3", "10x10.2")
  })
})

describe("surface-mount crystals", () => {
  test.each(["xtal2016", "xtal2520", "xtal3225", "xtal5032", "xtal7050"])("%s: four pads counter-clockwise from the bottom left", (text) => {
    const fp = make(text)
    expect(numbers(fp)).toEqual(["1", "2", "3", "4"])
    const [p1, p2, p3, p4] = ["1", "2", "3", "4"].map((n) => pad(fp, n))
    expect(p1!.x < 0 && p1!.y < 0).toBe(true)
    expect(p2!.x > 0 && p2!.y < 0).toBe(true)
    expect(p3!.x > 0 && p3!.y > 0).toBe(true)
    expect(p4!.x < 0 && p4!.y > 0).toBe(true)
    expectWellFormed(fp)
  })

  test.each(["xtal5032_2", "xtal3215", "hc49smd"])("%s: two pads", (text) => {
    const fp = make(text)
    expect(numbers(fp)).toEqual(["1", "2"])
    expectWellFormed(fp)
  })

  test("xtal3225 follows the Abracon ABM8 land pattern: 1.3 × 1.05 pads, gaps 1.0 and 0.7", () => {
    const fp = make("xtal3225")
    expect(pad(fp, 1)).toMatchObject({ x: -1.15, y: -0.875, width: 1.3, height: 1.05 })
    expect(pad(fp, 3)).toMatchObject({ x: 1.15, y: 0.875 })
  })

  test("near misses are not crystals", () => {
    notMine("xtal3226")
    notMine("xtal3225_2")
    notMine("hc49smd_p2")
  })
})

describe("surface-mount LEDs", () => {
  test("led3528: two pads, pad 1 anode at −x, cathode bar on the pad 2 side", () => {
    const fp = make("led3528")
    expect(numbers(fp)).toEqual(["1", "2"])
    expect(pad(fp, 1).x).toBeLessThan(0)
    expect(fp.silkscreen.some((line) => line.length === 2 && line[0]!.x > 0 && line[0]!.x === line[1]!.x)).toBe(true)
    expectWellFormed(fp)
  })

  test.each([["led5050", 4], ["led5050_6", 6]] as const)("%s: %i pads counter-clockwise from the bottom left", (text, count) => {
    const fp = make(text)
    expect(fp.pads).toHaveLength(count)
    const p1 = pad(fp, 1)
    expect(p1.x < 0 && p1.y < 0).toBe(true)
    expect(pad(fp, count).x < 0 && pad(fp, count).y > 0).toBe(true)
    expect(pad(fp, 2).x).toBeGreaterThan(p1.x)
    expectWellFormed(fp)
  })

  test("near misses", () => {
    notMine("led5050_5")
    notMine("led3529")
  })
})

describe("outlines are thin", () => {
  const count = (lines: readonly (readonly unknown[])[]) => lines.reduce((sum, line) => sum + line.length, 0)
  const LIMIT = 150

  test.each(["hc49smd", "smdcan10x10.2", "led5mm", "led3mm", "xtal3225", "smdcan4x5.4"])("%s keeps few points and its clearance", (text) => {
    const fp = make(text)
    expect(count(fp.silkscreen), `${text} silkscreen`).toBeLessThan(LIMIT)
    expect(count(fp.fabrication), `${text} fabrication`).toBeLessThan(LIMIT)
    expectWellFormed(fp)
  })

  test("a straight outline comes out as its corners only", () => {
    // xtal3225: body 3.2 × 2.5, its sides cleared of the corner pads: each run is two points, no point between.
    for (const line of make("xtal3225").silkscreen) expect(line).toHaveLength(2)
    expect(make("xtal3225").fabrication[0]).toHaveLength(5)
    expect(make("smdcan6.3x5.4").fabrication[0]).toHaveLength(7)
  })
})
