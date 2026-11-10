import { describe, expect, test } from "vitest"
import { APP_COMMANDS, CAMERA_COMMANDS, CANVAS_TOOL_COMMANDS, COPPER_COMMANDS, FIT_COMMANDS, PART_COMMANDS, PCB_COMMANDS, SHEET_COMMANDS, SHEET_LAYOUT_COMMANDS, WIRE_COMMANDS, WORKSPACE_COMMANDS, commandOwner } from "../studio/src/shell/command-owners.js"
import { MENUS, menuItems, type CommandId } from "../studio/src/shell/menus.js"
import { TOOLBARS } from "../studio/src/shell/toolbar.js"
import { buildTone, statusText } from "../studio/src/shell/status-pill.js"

const shown: CommandId[] = [
  ...MENUS.flatMap(menuItems).flatMap((item) => (item.command ? [item.command] : [])),
  ...[...TOOLBARS.schematic, ...TOOLBARS.pcb].flatMap((b) => (b.command ? [b.command] : [])),
]

describe("command owners", () => {
  test("every command the menu bar or the toolbar sends has someone to run it", () => {
    for (const command of shown) expect([command, commandOwner(command) !== undefined]).toEqual([command, true])
  })

  test("no command has two owners", () => {
    const all: string[] = [...APP_COMMANDS, ...Object.keys(WORKSPACE_COMMANDS), ...CAMERA_COMMANDS, ...FIT_COMMANDS, ...PART_COMMANDS, ...CANVAS_TOOL_COMMANDS, ...SHEET_COMMANDS, ...SHEET_LAYOUT_COMMANDS, ...WIRE_COMMANDS, ...PCB_COMMANDS, ...COPPER_COMMANDS]
    expect(new Set(all).size).toBe(all.length)
  })

  test("Grid style is the workspace's, as its toolbar button and menu item share one path", () => {
    expect(commandOwner("gridStyle")).toBe("workspace")
  })

  test("Undo and Redo are the app's own, so Ctrl+Z and Ctrl+Y work before a canvas has mounted", () => {
    expect(commandOwner("undo")).toBe("app")
    expect(commandOwner("redo")).toBe("app")
  })

  test("Open circuit file is the app's own, so it works before a canvas has mounted", () => {
    expect(commandOwner("openFile")).toBe("app")
  })

  test("Select all is the app's own, so Ctrl+A selects the circuit's parts before a canvas has mounted", () => {
    expect(commandOwner("selectAll")).toBe("app")
  })

  test("Find is the app's own, so Ctrl+F opens the Find Results tab before a canvas has mounted", () => {
    expect(commandOwner("find")).toBe("app")
  })

  test("Place → Note box is answered by either canvas, which arms its note tool", () => {
    const item = MENUS.find((menu) => menu.title === "Place")?.entries.find((entry) => entry !== "separator" && entry.label === "Note box")
    expect(item).toMatchObject({ command: "noteBox" })
    expect(item && item !== "separator" ? item.only : "missing").toBeUndefined()
    expect(commandOwner("noteBox")).toBe("canvas")
  })

  test("the eight align and distribute commands are answered by either canvas", () => {
    for (const command of ["alignLeft", "alignRight", "alignTop", "alignBottom", "alignHCentres", "alignVCentres", "distributeH", "distributeV"] as const) {
      expect([command, commandOwner(command)]).toEqual([command, "canvas"])
    }
  })

  test("Fit selection, Fit area and Rotate right are answered by either canvas, Snap by the workspace", () => {
    for (const command of ["fitSelection", "fitArea", "rotateRight"] as const) expect([command, commandOwner(command)]).toEqual([command, "canvas"])
    expect(commandOwner("snap")).toBe("workspace")
  })

  test("the schematic's tools are the schematic's alone", () => {
    expect(SHEET_COMMANDS.map(commandOwner)).toEqual(SHEET_COMMANDS.map(() => "schematic"))
    expect(SHEET_COMMANDS).toHaveLength(10)
  })

  test("Single routing and Via are the PCB's alone", () => {
    expect(PCB_COMMANDS).toEqual(["singleRouting", "placeVia"])
    expect(PCB_COMMANDS.map(commandOwner)).toEqual(["pcb", "pcb"])
  })

  test("Tidy sheet is the schematic's, which knows its parts and their locks", () => {
    expect(SHEET_LAYOUT_COMMANDS).toEqual(["tidySheet"])
    expect(commandOwner("tidySheet")).toBe("schematic")
  })

  test("Remove corners is the schematic's, which holds the selected wire; Delete and Highlight net stay the canvas's", () => {
    expect(commandOwner("removeCorners")).toBe("schematic")
    expect(commandOwner("delete")).toBe("canvas")
    expect(commandOwner("highlight")).toBe("canvas")
  })
})

describe("build status pill", () => {
  const done = { status: "done", design: {} } as never
  test("names the build state and the error count", () => {
    expect(statusText({ status: "building" }, 0)).toBe("Building")
    expect(statusText({ status: "failed" }, 0)).toBe("Build failed")
    expect(statusText({ status: "idle" }, 0)).toBe("Not built")
    expect(statusText(done, 0)).toBe("Build OK")
    expect(statusText(done, 1)).toBe("1 error")
    expect(statusText(done, 3)).toBe("3 errors")
  })

  test("is red for a failed build or any error, green for a clean one", () => {
    expect(buildTone({ status: "building" }, 2)).toBe("busy")
    expect(buildTone({ status: "failed" }, 0)).toBe("bad")
    expect(buildTone(done, 1)).toBe("bad")
    expect(buildTone(done, 0)).toBe("good")
    expect(buildTone({ status: "idle" }, 0)).toBe("idle")
  })
})

describe("the drawing tools", () => {
  test("are the schematic's", () => {
    for (const command of ["drawBus", "drawPolyline", "drawArc", "drawCircle", "drawRectangle", "drawText"] as const) expect([command, commandOwner(command)]).toEqual([command, "schematic"])
  })
})
