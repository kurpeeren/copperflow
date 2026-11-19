import { describe, expect, it } from "vitest"
import { desktopOff, NOT_IN_DESKTOP } from "../studio/src/shell/desktop-bridge.js"
import { MENUS, itemState, menuItems } from "../studio/src/shell/menus.js"

const projects = menuItems(MENUS[0]!).find((item) => item.command === "projects")!

describe("File → Projects… goes back to the desktop app's start screen", () => {
  it("is the first item of the File menu", () => {
    expect(MENUS[0]?.title).toBe("File")
    expect(menuItems(MENUS[0]!)[0]?.command).toBe("projects")
  })

  it("runs in the desktop app", () => {
    expect(itemState(projects, "pcb", 0, desktopOff({ backToProjects: async () => {} }))).toEqual({ enabled: true })
  })

  it("is off in a browser, and says where it works", () => {
    expect(itemState(projects, "pcb", 0, desktopOff(undefined))).toEqual({ enabled: false, reason: NOT_IN_DESKTOP })
  })
})
