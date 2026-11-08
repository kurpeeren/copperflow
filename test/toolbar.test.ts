import { describe, expect, test } from "vitest"
import { MENUS, menuItems } from "../studio/src/shell/menus.js"
import { TOOLBARS, armedCommand, isToolCommand, titleKey, toolbarGroups } from "../studio/src/shell/toolbar.js"
import { clearToolState, clickAction, getToolState, setToolState } from "../studio/src/shell/tool-state.js"

const ids = (view: "schematic" | "pcb") => TOOLBARS[view].map((b) => b.id)
const menuByCommand = new Map(MENUS.flatMap(menuItems).flatMap((item) => (item.command ? [[item.command, item] as const] : [])))

describe("toolbar", () => {
  test("the schematic row is in EasyEDA's order", () => {
    expect(ids("schematic")).toEqual(["undo", "zoomIn", "zoomOut", "fit", "component", "wire", "netLabel", "ground", "power", "rotate", "checkDrc"])
    expect(toolbarGroups("schematic").map((g) => g.length)).toEqual([1, 3, 5, 1, 1])
  })

  test("the PCB row is in EasyEDA's order", () => {
    expect(ids("pcb")).toEqual(["undo", "zoomIn", "zoomOut", "fit", "rotate", "checkDrc"])
    expect(toolbarGroups("pcb").map((g) => g.length)).toEqual([1, 3, 1, 1])
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
  })

  test("the shared state is set and cleared", () => {
    setToolState({ active: "wire", stop: null })
    expect(getToolState().active).toBe("wire")
    clearToolState()
    expect(getToolState().active).toBeNull()
  })
})
