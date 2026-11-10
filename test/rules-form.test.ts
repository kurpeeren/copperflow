import { describe, expect, test } from "vitest"
import { loadRules } from "../src/engine/rules/load.js"
import { filletRadiusField, FILLET_RADIUS_LABEL, FILLET_RADIUS_NOTE, readFilletRadius } from "../studio/src/shell/rules-form.js"
import { withFilletRadius } from "../src/core/rules-edit.js"
import { MENUS, menuItems } from "../studio/src/shell/menus.js"
import { commandOwner } from "../studio/src/shell/command-owners.js"

describe("the Fillet radius field", () => {
  test("is labelled, and its note gives the default and the floor rule", () => {
    expect(FILLET_RADIUS_LABEL).toBe("Fillet radius")
    expect(FILLET_RADIUS_NOTE).toContain("1 mm")
    expect(FILLET_RADIUS_NOTE).toContain("A track's width is the floor")
  })

  test("shows the radius rules.yaml sets, or nothing with the default as its placeholder", () => {
    expect(filletRadiusField(loadRules({}).rules.fabrication)).toEqual({ value: "", placeholder: "1 mm (default)" })
    expect(filletRadiusField(loadRules({ "rules.yaml": "fabrication:\n  filletRadius: 40mil\n" }).rules.fabrication).value).toBe("1.016")
    expect(filletRadiusField(undefined).value).toBe("")
  })

  test("reads a length in any unit rules.yaml takes; empty is the default", () => {
    expect(readFilletRadius("1.5")).toEqual({ radius: 1.5 })
    expect(readFilletRadius(" 0.5mm ")).toEqual({ radius: 0.5 })
    expect(readFilletRadius("40mil")).toEqual({ radius: 1.016 })
    expect(readFilletRadius("")).toEqual({ radius: null })
    for (const bad of ["0", "-1", "wide", "60"]) expect(readFilletRadius(bad)).toHaveProperty("message")
  })

  test("what the field writes, rules.yaml reads back", () => {
    for (const typed of ["2", "0.25mm", "40mil"]) {
      const read = readFilletRadius(typed)
      if (!("radius" in read) || read.radius === null) throw new Error("not read")
      const text = withFilletRadius("globalNets: [GND]\n", read.radius)
      expect(filletRadiusField(loadRules({ "rules.yaml": text }).rules.fabrication).value).toBe(String(read.radius))
    }
  })
})

describe("Design → Design rules", () => {
  test("runs and is the app's own", () => {
    const item = MENUS.find((menu) => menu.title === "Design")?.entries.find((entry) => entry !== "separator" && entry.label === "Design rules")
    expect(item).toEqual({ label: "Design rules", command: "designRules" })
    expect(commandOwner("designRules")).toBe("app")
    expect(MENUS.flatMap(menuItems).filter((one) => one.label === "Design rules")).toHaveLength(1)
  })
})
