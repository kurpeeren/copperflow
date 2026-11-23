import { describe, expect, test } from "vitest"
import { writeGerber } from "../src/engine/fab/gerber.js"
import { GerberError, gerberToSvg, isGerberName } from "../src/engine/fab/gerber-svg.js"

const CREATED = new Date("2026-11-23T10:00:00Z")

/** Every number pair in the paths' d attributes, as SVG coordinates (y down). */
const pathPoints = (svg: string) =>
  [...svg.matchAll(/ d="([^"]+)"/g)].flatMap((m) => [...(m[1] as string).matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((p) => ({ x: Number(p[1]), y: Number(p[2]) })))

describe("gerberToSvg", () => {
  test("a layer copperflow writes comes back at its own scale, y turned down", () => {
    const text = writeGerber(
      {
        fileFunction: "Copper,L1,Top",
        polarity: "Positive",
        objects: [
          { kind: "flash", at: { x: 10, y: 5 }, aperture: { shape: "circle", diameter: 2 } },
          { kind: "flash", at: { x: -10, y: -5 }, aperture: { shape: "rect", width: 2, height: 1 } },
          { kind: "flash", at: { x: 0, y: 8 }, aperture: { shape: "obround", width: 3, height: 1 } },
          { kind: "flash", at: { x: 0, y: -8 }, aperture: { shape: "roundrect", width: 2, height: 1, radius: 0.25, rotation: 30 } },
          { kind: "draw", points: [{ x: -10, y: 5 }, { x: 10, y: -5 }], width: 0.5 },
          { kind: "region", points: [{ x: 20, y: 0 }, { x: 25, y: 0 }, { x: 25, y: 5 }] },
          { kind: "region", points: [{ x: 21, y: 1 }, { x: 22, y: 1 }, { x: 22, y: 2 }], polarity: "clear" },
        ],
      },
      CREATED,
    )
    const picture = gerberToSvg(text)
    expect(picture.box.minX).toBeCloseTo(-11)
    expect(picture.box.maxX).toBeCloseTo(25)
    expect(picture.box.maxY).toBeCloseTo(8.5)
    expect(picture.pixel).toBeCloseTo(1 / 20)
    expect(picture.width).toBe(Math.ceil((36 + 2) * 20))
    expect(picture.svg).toMatch(/^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="760" height="\d+" viewBox="-12 -9.5 /)
    // The clear region masks the dark shapes before it.
    expect(picture.svg).toMatch(/<mask id="m0"[^>]*>.*<\/mask>/)
    expect(picture.svg).toContain('mask="url(#m0)"')
    expect(pathPoints(picture.svg)).toContainEqual({ x: 25, y: -5 })
    expect(picture.skipped).toEqual([])
  })

  test("arcs, inches, trailing zeros, step and repeat and macros are read", () => {
    const text = [
      "%FSTAX24Y24*%",
      "%MOIN*%",
      "%AMBOX*0 a centre line*21,1,$1,$2,0,0,0*$3=$1x2*1,1,$3,0,0*20,0,0.1,0,0,1,0,0*%",
      "%ADD10C,0.01*%",
      "%ADD11BOX,0.1X0.05*%",
      "%ADD12P,0.2X6*%",
      "%ADD13ROUND,0.1*%",
      "%SRX2Y1I1J0*%",
      "D10*",
      "G75*",
      "X0Y0D02*",
      "G03X01Y0I005J0D01*",
      "D11*",
      "X02Y02D03*",
      "D12*",
      "X03Y03D03*",
      "D13*",
      "X04Y04D03*",
      "%SR*%",
      "G36*",
      "G01X0Y-01D02*",
      "X01Y-01D01*",
      "X01Y-02D01*",
      "G37*",
      "%LMX*%",
      "M02*",
    ].join("\n")
    const picture = gerberToSvg(text)
    // The hexagon at 3 inch reaches 3.1, and the block is repeated 1 inch to the right.
    expect(picture.box.maxX).toBeCloseTo(25.4 * 4.1, 3)
    expect(picture.box.minY).toBeCloseTo(-2 * 25.4, 3)
    expect(picture.skipped).toEqual(expect.arrayContaining(["macro primitives with exposure off", "aperture ROUND (not defined)", "aperture mirroring, turning and scaling (LM, LR, LS)"]))
    // The half circle above the line from 0 to 1 inch reaches 0.5 inch up (plus half the line).
    expect(Math.min(...pathPoints(picture.svg).map((p) => p.y))).toBeLessThan(-10)
  })

  test("what is not a Gerber layer, or draws nothing, is refused", () => {
    expect(() => gerberToSvg("hello")).toThrow(GerberError)
    expect(() => gerberToSvg("%FSLAX36Y36*%\n%MOMM*%\nM02*")).toThrow(/draws nothing/)
    expect(() => gerberToSvg("%FSQ*%\nM02*")).toThrow(/format statement/)
    expect(() => gerberToSvg("%FSLAX36Y36*%\n%MOMM")).toThrow(/not closed/)
  })

  test("Gerber file names", () => {
    expect(isGerberName("Gerber_TopLayer.GTL")).toBe(true)
    expect(isGerberName("board-F_Cu.gbr")).toBe(true)
    expect(isGerberName("photo.jpg")).toBe(false)
  })
})
