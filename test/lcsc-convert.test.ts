// Conversion of copperflow's own EasyEDA-format fixtures (see test/helpers/lcsc-fixtures.ts) and of single records.
import { describe, expect, test } from "vitest"
import { footprintFromFile, pinErrors } from "../src/engine/footprints/file.js"
import { stringify } from "yaml"
import { arcPoints, pathPolylines } from "../src/library/easyeda-path.js"
import { convertFootprint } from "../src/library/easyeda-footprint.js"
import { pinName, pinType, symbolPins } from "../src/library/easyeda-symbol.js"
import { convertLcscAnswer, lcscNumber, matchPins } from "../src/library/lcsc-part.js"
import { lcscFixture } from "./helpers/lcsc-fixtures.js"

const TODAY = "2026-11-11"
const convert = (lcsc: string) => convertLcscAnswer(lcscFixture(lcsc), lcsc, TODAY)
/** A footprint document with these records around the origin 4000, 3000. */
const doc = (...shape: string[]) => ({ head: { x: 4000, y: 3000 }, shape })

describe("SOIC-8 (LM358DR2G, C7950)", () => {
  const { part, footprint, notes, suggestedId } = convert("C7950")

  test("the attributes: MPN, manufacturer without the bracketed local name, LCSC number, datasheet and origin", () => {
    expect(part).toMatchObject({
      title: "LM358DR2G, SOIC-8_L4.9-W3.9-P1.27-LS6.0-BL",
      manufacturer: "onsemi",
      mpn: "LM358DR2G",
      origin: "lcsc C7950, imported 2026-11-11",
      footprint: "footprint.yaml",
      suppliers: { lcsc: "C7950" },
      datasheet: { url: "https://www.lcsc.com/datasheet/C7950.pdf" },
    })
    expect(part.description).toContain("JLCEDA/EasyEDA Official Library (https://lceda.cn/, https://easyeda.com)")
    expect(suggestedId).toBe("LM358DR2G")
  })

  test("pads in mm with y up: 10 mil units, pitch 1.27, pin 1 at the lower left", () => {
    expect(footprint.pads).toHaveLength(8)
    expect(footprint.pads.find((p) => p.number === "1")).toEqual({ number: "1", shape: "oval", x: -1.905, y: -2.7, width: 0.6, height: 1.55 })
    expect(footprint.pads.find((p) => p.number === "8")).toMatchObject({ x: -1.905, y: 2.7 })
    expect(footprint.pads.find((p) => p.number === "4")).toMatchObject({ x: 1.905, y: -2.7 })
  })

  test("pins from the symbol: names made valid with the EasyEDA name kept, supply and ground from the names", () => {
    expect(part.pins["1"]).toEqual({ name: "_1OUT", type: "passive", description: "EasyEDA name: 1OUT" })
    expect(part.pins["2"]).toMatchObject({ name: "_1INN" })
    expect(part.pins["3"]).toMatchObject({ name: "_1INP" })
    expect(part.pins["4"]).toEqual({ name: "GND", type: "ground" })
    expect(part.pins["8"]).toEqual({ name: "VCC", type: "power_in" })
    expect(Object.keys(part.pins)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"])
  })

  test("the body from the outline, silkscreen lines, the arc and the dot as polylines, a courtyard around all", () => {
    expect(footprint.body).toEqual([
      [-2.45, -1.95],
      [2.45, -1.95],
      [2.45, 1.95],
      [-2.45, 1.95],
    ])
    expect(footprint.silkscreen ?? []).toHaveLength(7)
    const arc = (footprint.silkscreen ?? []).find((line) => line.length > 3 && line.every(([x, y]) => Math.abs(Math.hypot(x + 2.5, y) - 0.5) < 1e-3))
    expect(arc?.[0]).toEqual([-2.5, -0.5])
    expect(arc?.at(-1)).toEqual([-2.5, 0.5])
    // The pin-1 notch bulges into the body (+x), as drawn.
    const middle = arc?.[Math.floor((arc.length - 1) / 2)] ?? [0, 0]
    expect(middle[0]).toBeCloseTo(-2, 3)
    expect(middle[1]).toBeCloseTo(0, 3)
    expect(footprint.courtyard).toEqual([
      [-2.7, -3.725],
      [2.7, -3.725],
      [2.7, 3.725],
      [-2.7, 3.725],
    ])
    expect(notes).toEqual([])
  })

  test("the written footprint.yaml is valid and has a pad for every pin", () => {
    const built = footprintFromFile("footprint.yaml", stringify(footprint))
    expect("error" in built).toBe(false)
    expect(pinErrors(footprint, part)).toEqual([])
  })
})

describe("QFN-32 with an exposed pad (ESP32-C3, C2838500)", () => {
  const { part, footprint, notes } = convert("C2838500")

  test("32 pads counter-clockwise from the top left and the exposed pad as pin 33", () => {
    expect(footprint.pads).toHaveLength(33)
    expect(footprint.pads.find((p) => p.number === "1")).toEqual({ number: "1", shape: "rect", x: -2.45, y: 1.75, width: 0.8, height: 0.28 })
    expect(footprint.pads.find((p) => p.number === "9")).toMatchObject({ x: -1.75, y: -2.45, width: 0.28, height: 0.8 })
    expect(footprint.pads.find((p) => p.number === "33")).toEqual({ number: "33", shape: "rect", x: 0, y: 0, width: 3.7, height: 3.7 })
    expect(notes).toEqual([])
  })

  test("EasyEDA's power type and supply names make power pins, GND ground, the rest passive", () => {
    expect(part.pins["2"]).toEqual({ name: "VDD3P3", type: "power_in" })
    expect(part.pins["18"]).toEqual({ name: "VDD_SPI", type: "power_in" })
    expect(part.pins["33"]).toEqual({ name: "GND", type: "ground" })
    expect(part.pins["1"]).toEqual({ name: "LNA_IN", type: "passive" })
    expect(part.manufacturer).toBe("ESPRESSIF")
    expect(pinErrors(footprint, part)).toEqual([])
  })
})

describe("through-hole connector (JST B2B-XH-A, C158012)", () => {
  const { part, footprint, suggestedId } = convert("C158012")

  test("round through pads with their drills; a half turn of a round pad is dropped", () => {
    expect(footprint.pads).toEqual([
      { number: "1", shape: "circle", x: -1.25, y: 0, width: 1.7, height: 1.7, layers: "through", drill: 1 },
      { number: "2", shape: "circle", x: 1.25, y: 0, width: 1.7, height: 1.7, layers: "through", drill: 1 },
    ])
    expect(footprint.body?.[0]).toEqual([-3.7, -2.35])
  })

  test("pins named by number become pin1 and pin2; the id comes from the MPN", () => {
    expect(part.pins).toEqual({ "1": { name: "pin1", type: "passive" }, "2": { name: "pin2", type: "passive" } })
    expect(suggestedId).toBe("B2B-XH-A_LF_SN")
    expect(part.manufacturer).toBe("JST")
  })
})

describe("pad shapes", () => {
  const pad = (fields: string) => convertFootprint(doc(fields))

  test("a polygon pad is the rectangle around it, with a note", () => {
    const result = pad("PAD~POLYGON~4010~3000~2~2~1~~1~0~4008 2999 4013 2999 4013 3001 4008 3001~0~g~0~~Y~0")
    expect(result.pads[0]).toEqual({ number: "1", shape: "rect", x: 2.667, y: 0, width: 1.27, height: 0.508 })
    expect(result.notes[0]).toMatch(/polygon pad is drawn as the rectangle around it \(1\.27 x 0\.508 mm\)/)
  })

  test("an ellipse that is not round becomes an oval, with a note; a quarter turn swaps the sides", () => {
    const result = pad("PAD~ELLIPSE~4000~3000~4~2~1~~1~0~~90~g~0~~Y~0")
    expect(result.pads[0]).toEqual({ number: "1", shape: "oval", x: 0, y: 0, width: 0.508, height: 1.016 })
    expect(result.notes[0]).toMatch(/elliptical pad/)
  })

  test("EasyEDA's clockwise rotation on its y-down page is counter-clockwise in footprint.yaml", () => {
    expect(pad("PAD~RECT~4000~3000~4~2~1~~1~0~~30~g~0~~Y~0").pads[0]?.rotation).toBe(150)
  })

  test("a slot follows its own line; the hole length is the slot's full length", () => {
    const result = pad("PAD~OVAL~4000~3000~4~8~11~~1~1~~0~g~6~4000 2998 4000 3002~Y~0")
    expect(result.pads[0]).toMatchObject({ layers: "through", drill: { width: 0.508, height: 1.524 } })
  })

  test("unplated holes are left to the board with a note; a pad on the bottom is refused", () => {
    const result = convertFootprint(doc("PAD~RECT~4000~3000~4~4~1~~1~0~~0~g~0~~Y~0", "HOLE~4010~3000~2~h~0", "PAD~ELLIPSE~3990~3000~4~4~11~~~2~~0~g~0~~N~0"))
    expect(result.pads).toHaveLength(1)
    expect(result.notes).toEqual([
      "An unplated hole of 1.016 mm at (2.54, 0) is not in footprint.yaml; add it to the board as a hole.",
      "An unplated pad hole of 1.016 mm at (-2.54, 0) is not in footprint.yaml; add it to the board as a hole.",
      "The footprint draws no body outline, so footprint.yaml has none.",
    ])
    expect(() => pad("PAD~RECT~4000~3000~4~4~2~~1~0~~0~g~0~~Y~0")).toThrow(/bottom side/)
  })
})

describe("the body", () => {
  const PAD = "PAD~RECT~4000~3000~4~4~1~~1~0~~0~g~0~~Y~0"
  const track = (points: string) => `TRACK~1~99~~${points}~t~0`

  test("separate segments that touch are joined into a ring, in either direction", () => {
    const result = convertFootprint(doc(PAD, track("3990 2990 4010 2990"), track("4010 3010 4010 2990"), track("4010 3010 3990 3010 3990 2990")))
    expect(result.body).toEqual([
      [-2.54, 2.54],
      [2.54, 2.54],
      [2.54, -2.54],
      [-2.54, -2.54],
    ])
    expect(result.notes).toEqual([])
  })

  test("an outline that does not close gives no body and a note", () => {
    const result = convertFootprint(doc(PAD, track("3990 2990 4010 2990 4010 3010 3990 3010")))
    expect(result.body).toBeUndefined()
    expect(result.notes).toEqual(["The body outline (EasyEDA layer 99) is not closed, so footprint.yaml has no body."])
  })
})

describe("pins and pads that do not match", () => {
  const symbol = symbolPins(["P~show~0~1~0~0~0~a~0^^0~0^^M^^1~0~0~0~IN~start^^1~0~0~0~1~end", "P~show~0~2~0~0~0~b~0^^0~0^^M^^1~0~0~0~NC~start^^1~0~0~0~2~end"])
  const padAt = (number: string) => ({ number, shape: "rect" as const, x: 0, y: 0, width: 1, height: 1 })

  test("an EP pad becomes the next pin; a pin without a pad becomes no_connect; both are notes", () => {
    const result = matchPins(symbol, [padAt("1"), padAt("EP")])
    expect(result.pins).toEqual({
      "1": { name: "IN", type: "passive" },
      "2": { name: "NC", type: "no_connect" },
      "3": { name: "EP", type: "passive", description: "EasyEDA pad EP" },
    })
    expect(result.pads.map((p) => p.number)).toEqual(["1", "3"])
    expect(result.notes).toEqual([
      "Pad EP became pin 3 (EP, passive): footprint.yaml numbers pads with digits.",
      "Pin 2 (NC) has no pad in the footprint; it is marked no_connect.",
    ])
  })

  test("a symbol that numbers pins with letters is refused", () => {
    const bga = symbolPins(["P~show~0~A1~0~0~0~a~0^^0~0^^M^^1~0~0~0~VDD~start^^1~0~0~0~A1~end"])
    expect(() => matchPins(bga, [padAt("1")])).toThrow(/part wizard/)
  })
})

describe("names, numbers and paths", () => {
  test("pin names", () => {
    expect(pinName("CS#", "1")).toBe("CS_N")
    expect(pinName("~RESET", "1")).toBe("RESET_N")
    expect(pinName("{WR}", "1")).toBe("WR")
    expect(pinName("SO/SI", "1")).toBe("SO_SI")
    expect(pinName("IN-", "1")).toBe("INN")
    expect(pinName("", "7")).toBe("pin7")
    expect(pinName("12", "7")).toBe("pin7")
    expect(pinType({ number: "1", label: "AGND", electric: 0 })).toBe("ground")
    expect(pinType({ number: "1", label: "VSS", electric: 4 })).toBe("ground")
    expect(pinType({ number: "1", label: "OUT", electric: 4 })).toBe("power_in")
    expect(pinType({ number: "1", label: "OUT", electric: 2 })).toBe("passive")
  })

  test("LCSC numbers", () => {
    expect(lcscNumber(" c9657 ")).toBe("C9657")
    expect(() => lcscNumber("9657")).toThrow(/looks like C9657/)
    expect(() => lcscNumber("C96/../57")).toThrow()
  })

  test("paths with commas, relative moves and arcs", () => {
    expect(pathPolylines("M 0 0 L10,0 l 0 10 Z")).toEqual([
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 0 },
      ],
    ])
    const half = arcPoints({ x: -1, y: 0 }, { x: 1, y: 0 }, 1, 1, 0, false, true)
    expect(half.at(-1)).toEqual({ x: 1, y: 0 })
    for (const p of half) expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 9)
    expect(half.length).toBe(18)
  })

  test("EasyEDA's answers for a missing part or another part are refused", () => {
    expect(() => convertLcscAnswer({ success: false, code: 404, message: "Component not found" }, "C1", TODAY)).toThrow("EasyEDA has no part C1")
    expect(() => convertLcscAnswer(lcscFixture("C7950"), "C7951", TODAY)).toThrow(/answered with part C7950/)
    expect(() => convertLcscAnswer("<html>", "C1", TODAY)).toThrow(/not a part/)
  })
})
