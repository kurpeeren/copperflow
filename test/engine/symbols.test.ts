import { describe, expect, test } from "vitest"
import { elaborate } from "../../src/engine/elaborate.js"
import { evaluateCircuit } from "../../src/engine/evaluate.js"
import { KINDS } from "../../src/engine/kinds.js"
import type { Component, Side } from "../../src/engine/model.js"
import { groundSymbol, powerSymbol, symbolFor, type SchSymbol, type Shape } from "../../src/engine/symbols/index.js"

const MAIN = "main.circuit.tsx"
const noPads = { padCount: () => undefined }

function parts(body: string): Component[] {
  const source = `export default () => (\n  <board width="10mm" height="10mm">\n${body}\n  </board>\n)\n`
  return elaborate(evaluateCircuit({ [MAIN]: source }, MAIN), MAIN, noPads).components
}

function one(body: string): Component {
  const [component] = parts(body)
  if (!component) throw new Error("no component")
  return component
}

const elementFor = (kind: string) => {
  const counted = KINDS[kind]?.pins === "from-props" ? " pinCount={4}" : ""
  return `<${kind} name="X1"${counted} />`
}

const LDO_CHIP = `<chip name="U1" pinLabels={{ pin1: "VIN", pin2: "GND", pin3: "EN", pin4: "NC", pin5: "VOUT" }}
  pinAttributes={{ pin1: { requiresPower: true }, pin2: { requiresGround: true }, pin3: { isInput: true }, pin4: { doNotConnect: true }, pin5: { providesPower: true } }}`

const chip = (extra = "") => one(`${LDO_CHIP}${extra} />`)
const sideOf = (symbol: SchSymbol, name: string): Side | undefined => symbol.pins.find((pin) => pin.name === name)?.side
const onGrid = (value: number) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9
const numbers = (symbol: SchSymbol) => symbol.pins.map((pin) => pin.number)
type TextShape = Extract<Shape, { type: "text" }>
const textsOf = (shapes: Shape[]): TextShape[] => shapes.filter((s): s is TextShape => s.type === "text")

describe("built-in kinds", () => {
  test.each(Object.keys(KINDS))("%s has a symbol with its pins", (kind) => {
    const component = one(elementFor(kind))
    const symbol = symbolFor(component)
    expect(symbol.kind).toBe(kind)
    expect(numbers(symbol)).toEqual(component.pins.map((pin) => pin.number))
    expect(symbol.shapes.length).toBeGreaterThan(0)
  })

  test.each(Object.keys(KINDS))("%s has its pin ends on the 0.1 grid, inside its bounds", (kind) => {
    const symbol = symbolFor(one(elementFor(kind)))
    for (const pin of symbol.pins) {
      expect(onGrid(pin.end.x) && onGrid(pin.end.y)).toBe(true)
      expect(pin.end.x).toBeGreaterThanOrEqual(symbol.bounds.minX)
      expect(pin.end.x).toBeLessThanOrEqual(symbol.bounds.maxX)
      expect(pin.end.y).toBeGreaterThanOrEqual(symbol.bounds.minY)
      expect(pin.end.y).toBeLessThanOrEqual(symbol.bounds.maxY)
    }
  })

  test("two-pin symbols are horizontal with ends at -0.5 and 0.5", () => {
    for (const kind of ["resistor", "capacitor", "inductor", "fuse", "crystal", "switch", "diode", "led", "battery"]) {
      const ends = symbolFor(one(elementFor(kind))).pins.map((pin) => [pin.end.x, pin.end.y])
      expect(ends, kind).toEqual([[-0.5, 0], [0.5, 0]])
    }
  })

  test("three-pin symbols and the others put their ends where the decisions say", () => {
    const ends = (kind: string) => Object.fromEntries(symbolFor(one(elementFor(kind))).pins.map((p) => [p.number, [p.end.x, p.end.y]]))
    expect(ends("transistor")).toEqual({ 1: [-0.5, 0], 2: [0.3, -0.5], 3: [0.3, 0.5] })
    expect(ends("mosfet")).toEqual({ 1: [-0.5, 0], 2: [0.3, -0.5], 3: [0.3, 0.5] })
    expect(ends("potentiometer")).toEqual({ 1: [-0.5, 0], 2: [0, 0.4], 3: [0.5, 0] })
    expect(ends("testpoint")).toEqual({ 1: [0, -0.3] })
    const button = ends("pushbutton")
    expect([button[1]?.[0], button[2]?.[0], button[3]?.[0], button[4]?.[0]]).toEqual([-0.5, -0.5, 0.5, 0.5])
  })

  test("text uses the decided sizes", () => {
    const texts = textsOf(symbolFor(one(`<resistor name="R1" resistance="10k" />`)).shapes)
    expect(texts.map((t) => [t.role, t.text, t.size])).toEqual([["reference", "R1", 0.16], ["value", "10k", 0.16]])
  })
})

describe("variants", () => {
  const shapesOf = (body: string): Shape[] => symbolFor(one(body)).shapes

  test("diode variants draw different bars", () => {
    const plain = shapesOf(`<diode name="D1" />`)
    const variants = ["zener", "tvs", "schottky"].map((variant) => shapesOf(`<diode name="D1" variant="${variant}" />`))
    for (const shapes of variants) expect(shapes).not.toEqual(plain)
    expect(new Set(variants.map((v) => JSON.stringify(v))).size).toBe(3)
  })

  test("inherited property names are not variants", () => {
    const plain = shapesOf(`<diode name="D1" />`)
    for (const variant of ["constructor", "toString", "hasOwnProperty", "valueOf", "__proto__"]) {
      expect(shapesOf(`<diode name="D1" variant="${variant}" />`), variant).toEqual(plain)
    }
    const stranger: Component = { ...chip(), kind: "constructor" }
    expect(symbolFor(stranger).pins).toHaveLength(5)
  })

  test("pnp and p-channel turn the arrow", () => {
    expect(shapesOf(`<transistor name="Q1" type="pnp" />`)).not.toEqual(shapesOf(`<transistor name="Q1" type="npn" />`))
    expect(shapesOf(`<mosfet name="Q1" channelType="p" />`)).not.toEqual(shapesOf(`<mosfet name="Q1" channelType="n" />`))
  })

  test("a polarized capacitor draws a curved plate and a +", () => {
    const polarized = shapesOf(`<capacitor name="C1" polarized />`)
    expect(polarized.some((s) => s.type === "arc")).toBe(true)
    expect(textsOf(polarized).some((t) => t.text === "+")).toBe(true)
    expect(shapesOf(`<capacitor name="C1" />`).some((s) => s.type === "arc")).toBe(false)
  })
})

describe("chip boxes", () => {
  test("pins go to their sides by type", () => {
    const symbol = symbolFor(chip())
    expect(sideOf(symbol, "VIN")).toBe("top")
    expect(sideOf(symbol, "GND")).toBe("bottom")
    expect(sideOf(symbol, "VOUT")).toBe("right")
    expect(sideOf(symbol, "EN")).toBe("left")
    expect(sideOf(symbol, "NC")).toBe("left")
  })

  test("pinSides overrides the type", () => {
    expect(sideOf(symbolFor(chip(` pinSides={{ pin1: "left" }}`)), "VIN")).toBe("left")
  })

  test("within a side, pins run by number from the top", () => {
    const left = symbolFor(chip()).pins.filter((pin) => pin.side === "left")
    expect(left.map((pin) => pin.name)).toEqual(["EN", "NC"])
    expect(left[0]!.end.y).toBeGreaterThan(left[1]!.end.y)
    expect(left[0]!.end.x).toBe(left[1]!.end.x)
  })

  test("pins are 0.2 apart and 0.2 long", () => {
    const symbol = symbolFor(chip())
    const [first, second] = symbol.pins.filter((pin) => pin.side === "left")
    expect(first!.end.y - second!.end.y).toBeCloseTo(0.2, 9)
    const lead = symbol.shapes.find((s) => s.type === "polyline" && !s.closed && s.points.some((p) => p.x === first!.end.x && p.y === first!.end.y))
    if (lead?.type !== "polyline") throw new Error("no lead")
    expect(Math.abs(lead.points[0]!.x - lead.points[1]!.x)).toBeCloseTo(0.2, 9)
  })

  test("the box grows with its pins", () => {
    const labels = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`pin${i + 1}`, `P${i + 1}`]))
    const tall = symbolFor(one(`<chip name="U1" pinLabels={${JSON.stringify(labels)}} />`))
    expect(tall.bounds.maxY - tall.bounds.minY).toBeGreaterThanOrEqual(1.6)
  })

  test("the box widens with long names and is at least 1.0 wide", () => {
    const narrow = symbolFor(one(`<chip name="U1" pinLabels={{ pin1: "A", pin2: "B" }} />`))
    const wide = symbolFor(one(`<chip name="U1" pinLabels={{ pin1: "A_VERY_LONG_NAME", pin2: "B_VERY_LONG_NAME" }} pinAttributes={{ pin2: { isOutput: true } }} />`))
    const width = (s: SchSymbol) => {
      const box = s.shapes.find((shape) => shape.type === "polyline" && shape.closed)
      if (box?.type !== "polyline") throw new Error("no box")
      return Math.max(...box.points.map((p) => p.x)) - Math.min(...box.points.map((p) => p.x))
    }
    expect(width(narrow)).toBeCloseTo(1, 9)
    expect(width(wide)).toBeGreaterThan(width(narrow))
    expect(onGrid(width(wide) / 2)).toBe(true)
  })

  test("a 14-pin chip has every pin end on the grid", () => {
    const labels = Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`pin${i + 1}`, `IO${i + 1}`]))
    const sides = `{ pin1: "top", pin2: "top", pin3: "top", pin14: "bottom" }`
    const symbol = symbolFor(one(`<chip name="U1" pinLabels={${JSON.stringify(labels)}} pinSides={${sides}} />`))
    expect(symbol.pins).toHaveLength(14)
    for (const pin of symbol.pins) expect(onGrid(pin.end.x) && onGrid(pin.end.y)).toBe(true)
  })

  test("pinheader, connector, resonator and unknown kinds are boxes", () => {
    for (const kind of ["pinheader", "connector", "resonator"]) {
      const shapes = symbolFor(one(elementFor(kind))).shapes
      expect(shapes.some((s) => s.type === "polyline" && s.closed), kind).toBe(true)
    }
    const stranger: Component = { ...chip(), kind: "gizmo" }
    expect(symbolFor(stranger).kind).toBe("gizmo")
    expect(numbers(symbolFor(stranger))).toEqual([1, 2, 3, 4, 5])
  })

  test("symbolFor does not change its input", () => {
    const component = chip()
    const before = JSON.stringify(component)
    symbolFor(component)
    expect(JSON.stringify(component)).toBe(before)
  })
})

describe("pinSides in elaboration", () => {
  test("reads pinSides into the component", () => {
    expect(chip(` pinSides={{ pin1: "left", pin5: "top" }}`).pinSides).toEqual({ 1: "left", 5: "top" })
  })

  test("reports a bad side and keeps the rest", () => {
    const source = `export default () => (<board width="10mm" height="10mm">${LDO_CHIP} pinSides={{ pin1: "up", pin5: "top" }} /></board>)`
    const circuit = elaborate(evaluateCircuit({ [MAIN]: source }, MAIN), MAIN, noPads)
    expect(circuit.components[0]?.pinSides).toEqual({ 5: "top" })
    expect(circuit.diagnostics.map((d) => d.code)).toEqual(["bad-value"])
  })
})

describe("ground and power", () => {
  test("ground is bars below an attachment point at the origin", () => {
    const shapes = groundSymbol()
    expect(shapes.every((s) => s.type === "polyline")).toBe(true)
    expect(shapes.some((s) => s.type === "polyline" && s.points.some((p) => p.x === 0 && p.y === 0))).toBe(true)
  })

  test("power is a bar above the origin with the net name", () => {
    const shapes = powerSymbol("+3V3")
    expect(textsOf(shapes).some((t) => t.text === "+3V3")).toBe(true)
    expect(shapes.some((s) => s.type === "polyline" && s.points.some((p) => p.x === 0 && p.y === 0))).toBe(true)
  })
})
