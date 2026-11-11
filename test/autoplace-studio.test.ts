import { describe, expect, test } from "vitest"
import { buildDesign } from "../src/engine/design.js"
import { placeInstanceScope, placeSelectionScope } from "../studio/src/pcb/autoplace.js"
import { commandOwner } from "../studio/src/shell/command-owners.js"
import { itemState, MENUS, menuItems } from "../studio/src/shell/menus.js"

const STAGE = `export default function Stage() {
  return (
    <sheet>
      <port name="VIN" />
      <resistor name="R1" resistance="1k" footprint="0603" />
      <trace from="R1.pin1" to="net.VIN" />
    </sheet>
  )
}
`
const MAIN = `import Stage from "./Stage.sheet"
export default () => (
  <board width="20mm" height="20mm">
    <resistor name="R1" resistance="1k" footprint="0603" />
    <Stage name="S1" connections={{ VIN: "V" }} />
  </board>
)
`
const design = buildDesign({ "main.circuit.tsx": MAIN, "Stage.sheet.tsx": STAGE }, "main.circuit.tsx")
const item = (menu: string, label: string) => menuItems(MENUS.find((m) => m.title === menu)!).find((i) => i.label === label)!

describe("Place → Autoplace commands", () => {
  test("the menu items, on the PCB only, run by the app; the selection ones need a part", () => {
    for (const [menu, label, command] of [
      ["Place", "Autoplace", "autoplace"],
      ["Place", "Autoplace selection", "autoplaceSelection"],
      ["Place", "Autoplace instance", "autoplaceInstance"],
      ["Layout", "Fit board", "fitBoard"],
    ] as const) {
      const one = item(menu, label)
      expect(one.command).toBe(command)
      expect(commandOwner(command)).toBe("app")
      expect(itemState(one, "schematic").enabled).toBe(false)
      expect(itemState(one, "pcb", 1).enabled).toBe(true)
    }
    expect(itemState(item("Place", "Autoplace"), "pcb", 0).enabled).toBe(true)
    expect(itemState(item("Place", "Autoplace selection"), "pcb", 0).enabled).toBe(false)
  })

  test("the scopes: the selected parts (an instance symbol stands for its parts), or the instance a part is in", () => {
    expect(placeSelectionScope(design, ["R1", "S1"])).toEqual({ kind: "parts", parts: ["R1", "R101"] })
    expect(placeSelectionScope(design, [])).toEqual({ message: expect.any(String) })
    expect(placeInstanceScope(design, ["R101"])).toEqual({ kind: "instance", instance: "S1" })
    expect(placeInstanceScope(design, ["R1"])).toEqual({ message: expect.stringMatching(/sub-sheet instance/) })
  })
})
