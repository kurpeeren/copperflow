import { describe, expect, test } from "vitest"
import { BUILTIN_PARTS } from "../src/core/place.js"
import { buildDesign } from "../src/engine/design.js"
import { PLACE_DEFAULTS, placeDefaults, propText } from "../studio/src/place-defaults.js"
import { SUGGESTED_PROPS } from "../studio/src/inspector-sections.js"

/** A circuit with one part of `kind`, written as the Studio writes a placed part: its starting props as JSX attributes. */
function onePart(kind: string): string {
  const attrs = Object.entries(placeDefaults(kind))
    .map(([key, value]) => (typeof value === "string" ? `${key}="${value}"` : `${key}={${JSON.stringify(value)}}`))
    .join(" ")
  return `export default () => (
  <board width="30mm" height="20mm">
    <${kind} name="X1" ${attrs} />
  </board>
)`
}

describe("starting props of every built-in part", () => {
  for (const kind of BUILTIN_PARTS) {
    test(`${kind} builds with no error for the part and a footprint with pads`, () => {
      const design = buildDesign({ "main.circuit.tsx": onePart(kind) }, "main.circuit.tsx")
      const errors = [...design.diagnostics, ...design.violations].filter((d) => d.severity === "error" && d.items.some((item) => item === "X1" || item.startsWith("X1.")))
      expect(errors.map((e) => e.message)).toEqual([])
      const placed = design.pcb.parts.find((part) => part.component === "X1")
      expect(placed?.pads.length ?? 0).toBeGreaterThan(0)
      // A pin header has no footprint prop, so its pads follow pinCount when the person changes it.
      if (kind === "pinheader") expect(placed?.pads.length).toBe(placeDefaults(kind).pinCount)
      else expect(placeDefaults(kind).footprint).toBeTruthy()
    })
  }

  test("every built-in kind has starting props", () => {
    expect(BUILTIN_PARTS.filter((kind) => PLACE_DEFAULTS[kind] === undefined)).toEqual([])
  })

  test("a part that is not built in has none", () => {
    expect(placeDefaults("my-ldo")).toEqual({})
  })

  test("the inspector's usual props carry the same starting values (one source)", () => {
    for (const kind of BUILTIN_PARTS) {
      const suggested = Object.fromEntries(SUGGESTED_PROPS[kind] ?? [])
      expect(suggested).toEqual(Object.fromEntries(Object.entries(placeDefaults(kind)).map(([key, value]) => [key, propText(value)])))
    }
  })

  test("a pin header changed to 6 pins gets 6 pads", () => {
    const six = onePart("pinheader").replace("pinCount={4}", "pinCount={6}")
    const design = buildDesign({ "main.circuit.tsx": six }, "main.circuit.tsx")
    expect(design.pcb.parts.find((part) => part.component === "X1")?.pads.length).toBe(6)
  })

  test("propText writes numbers as the inspector types them", () => {
    expect(propText(4)).toBe("4")
    expect(propText("10k")).toBe("10k")
  })
})
