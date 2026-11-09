import { describe, expect, test } from "vitest"
import { MENUS, menuItems } from "../studio/src/shell/menus.js"
import { TOOLBARS, armedCommand, isToolCommand, titleKey, toolbarGroups } from "../studio/src/shell/toolbar.js"
import { clearToolState, clickAction, getToolState, setToolState } from "../studio/src/shell/tool-state.js"

const ids = (view: "schematic" | "pcb") => TOOLBARS[view].map((b) => b.id)
const menuByCommand = new Map(MENUS.flatMap(menuItems).flatMap((item) => (item.command ? [[item.command, item] as const] : [])))

describe("toolbar", () => {
  test("the schematic row is in EasyEDA's order", () => {
    expect(ids("schematic")).toEqual(["undo", "redo", "zoomIn", "zoomOut", "fit", "gridStyle", "component", "wire", "netLabel", "ground", "power", "rotate", "checkDrc"])
    expect(toolbarGroups("schematic").map((g) => g.length)).toEqual([2, 3, 1, 5, 1, 1])
  })

  test("the PCB row is in EasyEDA's order", () => {
    expect(ids("pcb")).toEqual(["undo", "redo", "zoomIn", "zoomOut", "fit", "gridStyle", "unit", "rotate", "checkDrc"])
    expect(toolbarGroups("pcb").map((g) => g.length)).toEqual([2, 3, 2, 1, 1])
  })

  test("Redo sits beside Undo in both rows and runs the Edit menu's Redo", () => {
    for (const view of ["schematic", "pcb"] as const) {
      expect(TOOLBARS[view].find((b) => b.id === "redo")).toEqual({ id: "redo", title: "Redo (Ctrl+Y)", icon: "redo", command: "redo", group: 0 })
    }
    expect(menuByCommand.get("redo")?.label).toBe("Redo")
  })

  test("the PCB's Unit button shows the unit as its text and runs the menu's Unit", () => {
    const unit = TOOLBARS.pcb.find((b) => b.id === "unit")
    expect(unit).toEqual({ id: "unit", title: "Unit (Q)", text: "unit", command: "toggleUnit", group: 2 })
    expect(TOOLBARS.schematic.some((b) => b.command === "toggleUnit")).toBe(false)
  })

  test("both rows have a Grid style button that runs the View menu's Grid style", () => {
    for (const view of ["schematic", "pcb"] as const) {
      expect(TOOLBARS[view].find((b) => b.id === "gridStyle")).toEqual({ id: "gridStyle", title: "Grid style", icon: "grid", command: "gridStyle", group: 2 })
    }
    expect(menuByCommand.get("gridStyle")?.label).toBe("Grid style")
    expect(menuByCommand.get("gridStyle")?.pending).toBeUndefined()
  })

  test("every other button has an icon", () => {
    for (const item of [...TOOLBARS.schematic, ...TOOLBARS.pcb]) expect([item.id, item.text === "unit" || item.icon !== undefined]).toEqual([item.id, true])
  })

  test("every button runs a command the menu has", () => {
    for (const item of [...TOOLBARS.schematic, ...TOOLBARS.pcb]) expect([item.id, menuByCommand.has(item.command)]).toEqual([item.id, true])
  })

  test("a title that names a key names the key the menu shows", () => {
    for (const item of [...TOOLBARS.schematic, ...TOOLBARS.pcb]) {
      expect([item.id, titleKey(item.title)]).toEqual([item.id, menuByCommand.get(item.command)?.shortcut])
    }
  })

  test("titleKey reads the last bracketed key only", () => {
    expect(titleKey("Wire (Alt+W)")).toBe("Alt+W")
    expect(titleKey("Check DRC")).toBeUndefined()
  })
})

describe("armed tools", () => {
  test("wiring wins, then the Place tool in hand", () => {
    expect(armedCommand(true, null)).toBe("wire")
    expect(armedCommand(false, "label")).toBe("netLabel")
    expect(armedCommand(false, "gnd")).toBe("groundFlag")
    expect(armedCommand(false, "vcc")).toBe("powerFlag")
    expect(armedCommand(false, null)).toBeNull()
  })

  test("only the four tool commands show pressed", () => {
    expect(["wire", "netLabel", "groundFlag", "powerFlag"].every((c) => isToolCommand(c as never))).toBe(true)
    expect(isToolCommand("fit")).toBe(false)
  })

  test("a second click on the armed tool puts it away; other clicks run the command", () => {
    const stop = () => {}
    expect(clickAction("wire", { active: "wire", stop })).toBe("stop")
    expect(clickAction("wire", { active: "netLabel", stop })).toBe("run")
    expect(clickAction("fit", { active: null, stop: null })).toBe("run")
    expect(clickAction("wire", { active: "wire", stop: null })).toBe("run")
  })

  test("the shared state is set and cleared", () => {
    setToolState({ active: "wire", stop: null })
    expect(getToolState().active).toBe("wire")
    clearToolState()
    expect(getToolState().active).toBeNull()
  })
})
