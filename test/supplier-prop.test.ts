import { describe, expect, test } from "vitest"
import { applyEdits, EditError } from "../src/core/edit.js"
import { BOARD } from "./fixtures.js"

const none = new Set<string>()

describe("set_props writes a built-in part's supplier part number", () => {
  test('"jlcpcb:C25804" is written as the object the BOM reads', () => {
    const out = applyEdits(BOARD, [{ kind: "setProps", part: "R1", props: { supplierPartNumbers: "jlcpcb:C25804" } }], none)
    expect(out).toContain('supplierPartNumbers={{ jlcpcb: ["C25804"] }}')
  })

  test("a number written that way can be set again and removed with null", () => {
    const once = applyEdits(BOARD, [{ kind: "setProps", part: "R1", props: { supplierPartNumbers: "jlcpcb:C25804" } }], none)
    const twice = applyEdits(once, [{ kind: "setProps", part: "R1", props: { supplierPartNumbers: "lcsc:C1" } }], none)
    expect(twice).toContain('supplierPartNumbers={{ lcsc: ["C1"] }}')
    expect(twice).not.toContain("C25804")
    expect(applyEdits(twice, [{ kind: "setProps", part: "R1", props: { supplierPartNumbers: null } }], none)).toBe(BOARD)
  })

  test("a value without a supplier is refused with the shape to use", () => {
    expect(() => applyEdits(BOARD, [{ kind: "setProps", part: "R1", props: { supplierPartNumbers: "C25804" } }], none)).toThrow(EditError)
    expect(() => applyEdits(BOARD, [{ kind: "setProps", part: "R1", props: { supplierPartNumbers: "C25804" } }], none)).toThrow('supplierPartNumbers takes "<supplier>:<number>", e.g. "jlcpcb:C25804"')
  })
})
