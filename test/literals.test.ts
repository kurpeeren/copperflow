import { describe, expect, test } from "vitest"
import { analyzeCircuit } from "../src/core/analyze.js"
import { formatLiteral, validateProp } from "../src/core/literals.js"

const propOf = (attribute: string) => analyzeCircuit(`<board><led name="D1" ${attribute} /></board>`).parts[0]?.props.p

describe("readLiteral", () => {
  test("reads booleans and strings in braces", () => {
    expect(propOf("p={false}")?.literal).toBe(false)
    expect(propOf('p={"x"}')?.literal).toBe("x")
  })

  test("treats other expressions as non-literals", () => {
    expect(propOf("p={-x}")?.editable).toBe(false)
    expect(propOf("p={!true}")?.editable).toBe(false)
    expect(propOf("p={`a${b}`}")?.editable).toBe(false)
    expect(propOf("p={<span />}")?.editable).toBe(false)
  })
})

describe("readPointList", () => {
  const hintsOf = (list: string) =>
    analyzeCircuit(`<board><trace from="R1.pin1" to="net.GND" schematicRouteHints={${list}} /></board>`).traces[0]?.schematicRouteHints

  test("reads only plain finite x and y numbers", () => {
    expect(hintsOf("[{ x: -0, y: 1e-3 }]")).toEqual([{ x: -0, y: 0.001 }])
    expect(hintsOf("[{ [x]: 1, y: 2 }]")).toBeUndefined()
    expect(hintsOf("[{ x: 1e999, y: 2 }]")).toBeUndefined()
    expect(hintsOf("[{ x: 1, y: 2, z: 3 }]")).toBeUndefined()
  })
})

describe("formatLiteral", () => {
  test("formats each literal kind", () => {
    expect(formatLiteral("0402")).toBe('"0402"')
    expect(formatLiteral("a{b}")).toBe('{"a{b}"}')
    expect(formatLiteral(-2.5)).toBe("{-2.5}")
    expect(formatLiteral(true)).toBe("{true}")
  })
})

describe("validateProp", () => {
  test("rejects values that are not literals", () => {
    expect(() => validateProp("pcbX", null)).toThrow(/string, number or boolean/)
    expect(() => validateProp("key", "x")).toThrow(/cannot be changed/)
    expect(() => validateProp("pcbX", Number.POSITIVE_INFINITY)).toThrow(/finite/)
  })
})
