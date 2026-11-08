import { describe, expect, test } from "vitest"
import { APP_COMMANDS, CAMERA_COMMANDS, PART_COMMANDS, SHEET_COMMANDS, WORKSPACE_COMMANDS, commandOwner } from "../studio/src/shell/command-owners.js"
import { MENUS, menuItems, type CommandId } from "../studio/src/shell/menus.js"
import { TOOLBARS } from "../studio/src/shell/toolbar.js"
import { buildTone, statusText } from "../studio/src/shell/status-pill.js"

const shown: CommandId[] = [
  ...MENUS.flatMap(menuItems).flatMap((item) => (item.command ? [item.command] : [])),
  ...TOOLBARS.schematic.map((b) => b.command),
  ...TOOLBARS.pcb.map((b) => b.command),
]

describe("command owners", () => {
  test("every command the menu bar or the toolbar sends has someone to run it", () => {
    for (const command of shown) expect([command, commandOwner(command) !== undefined]).toEqual([command, true])
  })

  test("no command has two owners", () => {
    const all: string[] = [...APP_COMMANDS, ...Object.keys(WORKSPACE_COMMANDS), ...CAMERA_COMMANDS, ...PART_COMMANDS, ...SHEET_COMMANDS]
    expect(new Set(all).size).toBe(all.length)
  })

  test("Open circuit file is the app's own, so it works before a canvas has mounted", () => {
    expect(commandOwner("openFile")).toBe("app")
  })

  test("the schematic's tools are the schematic's alone", () => {
    expect(SHEET_COMMANDS.map(commandOwner)).toEqual(["schematic", "schematic", "schematic", "schematic"])
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
