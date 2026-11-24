import { describe, expect, test } from "vitest"
import { netNamer, netNames } from "../src/engine/fab/easyeda.js"
import { padString, textStart } from "../src/engine/fab/easyeda-parts.js"
import {
  copperAreaShape,
  field,
  holeShape,
  libShape,
  num,
  padShape,
  slotEnds,
  solidRegionShape,
  textShape,
  toBoard,
  toDocument,
  trackShape,
  units,
  viaShape,
} from "../src/engine/fab/easyeda-shapes.js"
import type { WorldPad } from "../src/engine/pcb.js"

describe("units and axes", () => {
  test("a format unit is 10 mil, 0.254 mm", () => {
    expect(units(0.254)).toBe("1")
    expect(units(2)).toBe("7.874")
    expect(units(25.4)).toBe("100")
  })

  test("numbers are written with at most four decimals, never -0 or an exponent", () => {
    expect(num(1 / 3)).toBe("0.3333")
    expect(num(-0.00001)).toBe("0")
    expect(num(1e-7)).toBe("0")
    expect(num(4010)).toBe("4010")
  })

  test("the board's (0, 0) lands on the document origin and y turns downward", () => {
    expect(toDocument({ x: 0, y: 0 })).toEqual({ x: 4000, y: 3000 })
    expect(toDocument({ x: 2.54, y: 2.54 })).toEqual({ x: 4010, y: 2990 })
    expect(toDocument({ x: -2.54, y: -5.08 })).toEqual({ x: 3990, y: 3020 })
  })

  test("a document point comes back as the board point it was", () => {
    const p = { x: 12.3, y: -4.56 }
    const back = toBoard(toDocument(p))
    expect(back.x).toBeCloseTo(p.x, 9)
    expect(back.y).toBeCloseTo(p.y, 9)
  })
})

describe("shape strings", () => {
  test("a track: width, layer, net, points, id, unlocked", () => {
    const line = trackShape({ width: 0.254, layer: 1, net: "GND", points: [{ x: 0, y: 0 }, { x: 2.54, y: 2.54 }], id: "gge7" })
    expect(line).toBe("TRACK~1~1~GND~4000 3000 4010 2990~gge7~0")
  })

  test("a via: its diameter and the radius of its hole", () => {
    expect(viaShape({ at: { x: 2.54, y: 0 }, diameter: 0.6, drill: 0.3, net: "V12", id: "gge2" })).toBe("VIA~4010~3000~2.3622~V12~0.5906~gge2~0")
  })

  test("a non-plated hole is written by its radius", () => {
    expect(holeShape({ at: { x: 0, y: 2.54 }, diameter: 3.2, id: "gge3" })).toBe("HOLE~4000~2990~6.2992~gge3~0")
  })

  test("a round through pad: ELLIPSE on the multi layer, its hole radius and centre", () => {
    const line = padShape({ shape: "ELLIPSE", at: { x: 2.54, y: 0 }, width: 1.6, height: 1.6, layer: 11, net: "GND", number: "1", rotation: 0, drill: { width: 0.8, height: 0.8 }, id: "gge4" })
    expect(line).toBe("PAD~ELLIPSE~4010~3000~6.2992~6.2992~11~GND~1~1.5748~~0~gge4~0~~Y~0~~~4010,3000")
  })

  test("a turned rectangular pad lists its four corners in document points", () => {
    const line = padShape({ shape: "RECT", at: { x: 0, y: 0 }, width: 2.54, height: 1.27, layer: 1, net: "", number: "2", rotation: 90, id: "gge5" })
    const fields = line.split("~")
    expect(fields.slice(0, 10)).toEqual(["PAD", "RECT", "4000", "3000", "10", "5", "1", "", "2", "0"])
    expect(fields[10]).toBe("3997.5 3005 3997.5 2995 4002.5 2995 4002.5 3005")
    expect(fields[11]).toBe("90")
  })

  test("a slotted pad: the slot's whole length and its two end centres along the turned pad", () => {
    const pad = { shape: "OVAL" as const, at: { x: 0, y: 0 }, width: 2, height: 4, layer: 11, net: "", number: "1", rotation: 90, drill: { width: 1, height: 3 }, id: "gge6" }
    const fields = padShape(pad).split("~")
    expect(fields[9]).toBe("1.9685")
    expect(fields[13]).toBe("11.811")
    expect(fields[14]).toBe("4003.937 3000 3996.063 3000")
    expect(slotEnds({ at: { x: 0, y: 0 }, rotation: 0, drill: { width: 3, height: 1 } }).map((p) => [p.x, p.y + 0])).toEqual([
      [-1, 0],
      [1, 0],
    ])
    expect(slotEnds({ at: { x: 0, y: 0 }, rotation: 0, drill: { width: 1, height: 1 } })).toEqual([])
  })

  test("a world pad keeps its net and number; a rounded rectangle becomes a plain one, a surface pad has no hole", () => {
    const pad: WorldPad = { id: "R1#1", component: "R1", number: "1", shape: "roundrect", x: 0, y: 0, width: 1, height: 0.5, rotation: 0, layers: "bottom", cornerRadius: 0.1, net: "net.GND" }
    const fields = padString(pad, (net) => (net === "net.GND" ? "GND" : ""), "gge9").split("~")
    expect([fields[1], fields[6], fields[7], fields[8], fields[9]]).toEqual(["RECT", "2", "GND", "1", "0"])
    const round = padString({ ...pad, shape: "circle", height: 3, layers: "through", drill: { width: 0.5, height: 0.5 } }, () => "", "gge10").split("~")
    expect([round[1], round[4], round[5], round[6]]).toEqual(["ELLIPSE", "3.937", "3.937", "11"])
  })

  test("a text: its kind, start, line width, turn, mirror, layer, height, words, strokes and whether it shows", () => {
    const line = textShape({
      kind: "L",
      start: { x: 0, y: 0 },
      lineWidth: 0.254,
      rotation: 90,
      mirrored: true,
      layer: 4,
      height: 2.54,
      text: "A~B",
      strokes: [[{ x: 0, y: 0 }, { x: 0, y: 2.54 }], []],
      shown: false,
      id: "gge8",
    })
    expect(line).toBe("TEXT~L~4000~3000~1~90~1~4~~10~A_B~M 4000 3000 L 4000 2990~none~gge8~~0~")
  })

  test("a solid region and a copper area take closed paths", () => {
    const ring = [{ x: 0, y: 0 }, { x: 2.54, y: 0 }, { x: 2.54, y: 2.54 }]
    expect(solidRegionShape({ layer: 3, net: "", ring, id: "gge1" })).toBe("SOLIDREGION~3~~M 4000 3000 L 4010 3000 L 4010 2990 Z~solid~gge1~~~~0")
    expect(copperAreaShape({ minWidth: 0.254, layer: 2, net: "GND", outline: ring, clearance: 0.508, thermal: "spoke", id: "gge2" })).toBe(
      "COPPERAREA~1~2~GND~M 4000 3000 L 4010 3000 L 4010 2990 Z~2~solid~gge2~spoke~none~[]~0",
    )
  })

  test("a footprint: its own fields, its attributes, the layer of its side, then its shapes after the separator", () => {
    const line = libShape({ at: { x: 2.54, y: 0 }, attributes: [["package", "R_0402"], ["Contributor", "copperflow"]], rotation: 90, side: "bottom", id: "gge1", children: ["TRACK~a", "PAD~b"] })
    expect(line).toBe("LIB~4010~3000~package`R_0402`Contributor`copperflow`~90~~gge1~2~~~0~~yes~~#@$TRACK~a#@$PAD~b")
    expect(libShape({ at: { x: 0, y: 0 }, attributes: [], rotation: 0, side: "top", id: "gge2", children: [] })).toBe("LIB~4000~3000~~0~~gge2~1~~~0~~yes~~")
  })

  test("the format's separators never reach a field", () => {
    expect(field("a~b`c#@$d")).toBe("a_b_c_d")
  })
})

describe("net names", () => {
  test("a net is written by its id without the net. prefix, separators made _", () => {
    const names = netNames(["net.GND", "net.RL1/GATE", "net.R1~2/A", "VCC"])
    expect([...names.values()]).toEqual(["GND", "RL1/GATE", "R1_2/A", "VCC"])
  })

  test("two nets that would share a name get numbers, so they never join", () => {
    expect([...netNames(["net.A_2", "net.A~2", "net.A`2"]).values()]).toEqual(["A_2", "A_2_2", "A_2_3"])
  })

  test("a net the circuit does not list is named against the same names, and an empty name is net", () => {
    const name = netNamer(["net.A~"])
    expect([name("net.A~"), name("net.A_"), name("net.A_"), name("net."), name(undefined)]).toEqual(["A_", "A__2", "A__2", "net", ""])
  })
})

describe("text start", () => {
  test("the left end of the baseline, turned about the centre, then mirrored", () => {
    expect(textStart({ x: 10, y: 10 }, 4, 2, 0, false)).toEqual({ x: 8, y: 9 })
    expect(textStart({ x: 10, y: 10 }, 4, 2, 0, true)).toEqual({ x: 12, y: 9 })
    const turned = textStart({ x: 0, y: 0 }, 4, 2, 90, false)
    expect(turned.x).toBeCloseTo(1, 9)
    expect(turned.y).toBeCloseTo(-2, 9)
  })
})
