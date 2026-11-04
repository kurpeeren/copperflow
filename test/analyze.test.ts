import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { BOARD } from "./fixtures.js"

describe("analyzeCircuit", () => {
  const model = analyzeCircuit(BOARD)
  const part = (name: string) => model.parts.find((p) => p.name === name)

  test("finds named parts with their tag and line", () => {
    expect(model.parts.map((p) => p.name)).toEqual(["R1", "C1", "LED1", "RX", "U1"])
    expect(part("R1")).toMatchObject({ tag: "resistor", line: 5, editable: true })
  })

  test("reads string, number and negative number literals", () => {
    const r1 = part("R1")!
    expect(r1.props.resistance).toMatchObject({ literal: "5.1k", editable: true })
    expect(r1.props.pcbX).toMatchObject({ literal: -4, editable: true, source: "{-4}" })
    expect(r1.props.pcbY?.literal).toBe(2)
  })

  test("marks expression props as read-only and keeps their source", () => {
    const led = part("LED1")!
    expect(led.editable).toBe(true)
    expect(led.props.pcbX).toMatchObject({ editable: false, source: "{offset + 2}" })
    expect(led.props.pcbX?.literal).toBeUndefined()
  })

  test("marks parts inside a callback as read-only", () => {
    expect(part("RX")).toMatchObject({ editable: false, readonlyReason: "inside a callback such as .map()" })
  })

  test("marks parts with spread props as read-only", () => {
    expect(part("U1")).toMatchObject({ editable: false, readonlyReason: "uses spread props" })
  })

  test("lists elements whose name is not a literal as skipped", () => {
    expect(model.skipped).toEqual([{ tag: "resistor", line: 17, reason: "name is not a string literal" }])
  })

  test("finds traces with literal endpoints", () => {
    expect(model.traces.map((t) => [t.from, t.to])).toEqual([
      [".R1 > .pin1", "net.GND"],
      [".C1 > .pin1", ".R1 > .pin2"],
    ])
    expect(model.traces.every((t) => t.editable)).toBe(true)
  })

  test("reads the corners of a hand-drawn schematic wire", () => {
    const m = analyzeCircuit(
      '<board><trace from="R1.pin1" to="net.GND" schematicRouteHints={[{ x: 1, y: -2.5 }, { x: 3, y: -2.5 }]} /><trace from="R1.pin2" to="net.GND" schematicRouteHints={corners} /></board>',
    )
    expect(m.traces[0]?.schematicRouteHints).toEqual([
      { x: 1, y: -2.5 },
      { x: 3, y: -2.5 },
    ])
    expect(m.traces[1]?.schematicRouteHints).toBeUndefined()
  })

  test("treats a valueless attribute as true and template literals as strings", () => {
    const m = analyzeCircuit("const x = <board><led name=\"D1\" doNotPlace color={`red`} /></board>")
    expect(m.parts[0]?.props.doNotPlace?.literal).toBe(true)
    expect(m.parts[0]?.props.color?.literal).toBe("red")
  })

  test("parts defined in a sub-component are editable", () => {
    const m = analyzeCircuit("const Power = () => <group name=\"power\"><resistor name=\"R5\" /></group>")
    expect(m.parts.map((p) => [p.name, p.editable])).toEqual([
      ["power", true],
      ["R5", true],
    ])
  })

  test("throws a readable error for invalid code", () => {
    expect(() => analyzeCircuit("<board>")).toThrow(/Could not parse/)
  })
})
