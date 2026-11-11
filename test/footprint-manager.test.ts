import { describe, expect, test } from "vitest"
import { analyzeCircuit, applyEdits } from "../src/core/index.js"
import { footprintEdits, footprintRows, usedFootprints } from "../studio/src/shell/footprint-manager.js"
import { MENUS, menuItems } from "../studio/src/shell/menus.js"
import { commandOwner } from "../studio/src/shell/command-owners.js"

const SOURCE = `export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0402" />
    <resistor name="R2" resistance="2k" footprint={size} />
    <capacitor name="C1" capacitance="1u" />
  </board>
)
`
const model = analyzeCircuit(SOURCE)
const components = [
  { id: "R1", kind: "resistor", value: "1k", footprint: "0402" },
  { id: "R2", kind: "resistor", value: "2k", footprint: "0603" },
  { id: "C1", kind: "capacitor", value: "1u", footprint: "0402" },
  { id: "U1", kind: "chip", footprint: "soic8", library: "ldo" },
]

describe("Tools → Footprint manager", () => {
  test("is an item the app runs", () => {
    const tools = MENUS.find((menu) => menu.title === "Tools")
    expect(tools && menuItems(tools)).toContainEqual({ label: "Footprint manager…", command: "footprintManager" })
    expect(commandOwner("footprintManager")).toBe("app")
  })

  test("lists every part with its footprint, and why one cannot change", () => {
    const rows = footprintRows({ components, parts: model.parts, locked: new Set(["C1"]) })
    expect(rows).toEqual([
      { name: "R1", kind: "resistor", value: "1k", footprint: "0402" },
      { name: "R2", kind: "resistor", value: "2k", footprint: "0603", fixed: "Written as {size}" },
      { name: "C1", kind: "capacitor", value: "1u", footprint: "0402", fixed: "Locked" },
      { name: "U1", kind: "chip", value: "", footprint: "soic8", fixed: "Not written in this file" },
    ])
    expect(usedFootprints(rows)).toEqual(["0402", "0603", "soic8"])
  })

  test("writes the changed footprints as one edit list the core takes", () => {
    const rows = footprintRows({ components, parts: model.parts, locked: new Set() })
    const plan = footprintEdits(rows, { R1: "0603", C1: " 0805 ", U1: "soic8" })
    if ("message" in plan) throw new Error(plan.message)
    expect(plan.summary).toBe("change footprints: R1 → 0603, C1 → 0805")
    const next = applyEdits(SOURCE, plan.edits, new Set())
    expect(next).toContain('<resistor name="R1" resistance="1k" footprint="0603" />')
    expect(next).toContain('<capacitor name="C1" capacitance="1u" footprint="0805" />')
  })

  test("refuses no change, a fixed part and a name with spaces", () => {
    const rows = footprintRows({ components, parts: model.parts, locked: new Set() })
    expect(footprintEdits(rows, {})).toEqual({ message: "No footprint was changed." })
    expect(footprintEdits(rows, { R2: "0805" })).toEqual({ message: "R2: Written as {size}" })
    expect(footprintEdits(rows, { R1: "bad name" })).toHaveProperty("message")
  })
})
