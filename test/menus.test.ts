import { describe, expect, test } from "vitest"
import { keyAction, type KeyInput } from "../studio/src/pcb/canvas-keys.js"
import { COMMAND_KEY_ACTIONS, MENUS, MENU_TITLES, menuItems, menuReducer, shortcutList } from "../studio/src/shell/menus.js"
import { send, subscribe } from "../studio/src/shell/commands.js"

/** A key press as `keyAction` reads it, from a shortcut as the menu shows it, e.g. "Alt+W" or "Shift+H". */
function pressOf(shortcut: string): KeyInput {
  const parts = shortcut.split("+")
  const last = parts.at(-1) ?? ""
  const key = last === "Space" ? " " : last.length === 1 ? last.toLowerCase() : last
  const shift = parts.includes("Shift")
  return {
    key: shift && key.length === 1 ? key.toUpperCase() : key,
    code: /^[a-z]$/.test(key) ? `Key${key.toUpperCase()}` : undefined,
    shiftKey: shift,
    altKey: parts.includes("Alt"),
    ctrlKey: parts.includes("Ctrl"),
    metaKey: false,
    typing: false,
  }
}

describe("menus", () => {
  test("the menu bar has EasyEDA's menus in EasyEDA's order", () => {
    expect(MENUS.map((m) => m.title)).toEqual(["File", "Edit", "View", "Place", "Design", "Route", "Layout", "Tools", "Export", "Settings", "Help"])
    expect(MENU_TITLES).toEqual(MENUS.map((m) => m.title))
  })

  test("every item either runs a command or says why it is not there yet", () => {
    for (const item of MENUS.flatMap(menuItems)) {
      expect([item.label, (item.command === undefined) !== (item.pending === undefined)]).toEqual([item.label, true])
    }
  })

  test("no menu has more than 14 items", () => {
    for (const menu of MENUS) expect([menu.title, menuItems(menu).length <= 14]).toEqual([menu.title, true])
  })

  test("Route and Settings hold only items that are still to come", () => {
    for (const title of ["Route", "Settings"]) {
      const menu = MENUS.find((m) => m.title === title)
      expect(menu && menuItems(menu).every((item) => item.pending !== undefined)).toBe(true)
    }
  })

  test("a shortcut shown beside a command does what the key does", () => {
    let checked = 0
    for (const item of MENUS.flatMap(menuItems)) {
      const expected = item.command && COMMAND_KEY_ACTIONS[item.command]
      if (!item.shortcut || !expected) continue
      const actions = (["schematic", "pcb"] as const).map((view) => keyAction(pressOf(item.shortcut ?? ""), { view })?.action)
      expect([item.label, item.shortcut, actions.includes(expected)]).toEqual([item.label, item.shortcut, true])
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(10)
  })

  test("the key list names every shortcut once, with the canvas-only keys", () => {
    const list = shortcutList()
    const keys = list.map((row) => row.keys)
    expect(new Set(keys).size).toBe(keys.length)
    for (const extra of ["W", "R", "F"]) expect(keys).toContain(extra)
    expect(keys).toContain("Ctrl+Z")
  })
})

describe("menuReducer", () => {
  const closed = { open: null }
  test("a click opens a menu and a second click on it closes it", () => {
    const opened = menuReducer(closed, { type: "click", title: "File" })
    expect(opened).toEqual({ open: "File" })
    expect(menuReducer(opened, { type: "click", title: "File" })).toEqual(closed)
    expect(menuReducer(opened, { type: "click", title: "Edit" })).toEqual({ open: "Edit" })
  })

  test("hovering switches menus only while one is open", () => {
    expect(menuReducer(closed, { type: "hover", title: "View" })).toEqual(closed)
    expect(menuReducer({ open: "File" }, { type: "hover", title: "View" })).toEqual({ open: "View" })
  })

  test("Esc, a click outside and running an item close the menu", () => {
    for (const type of ["escape", "outside", "run"] as const) expect(menuReducer({ open: "File" }, { type })).toEqual(closed)
  })
})

describe("command bus", () => {
  test("a command goes to the first handler that takes it, and nowhere after unsubscribing", () => {
    const seen: string[] = []
    const stopA = subscribe((command) => {
      seen.push(`a:${command}`)
      return command === "fit"
    })
    const stopB = subscribe((command) => {
      seen.push(`b:${command}`)
      return true
    })
    expect(send("fit")).toBe(true)
    expect(seen).toEqual(["a:fit"])
    expect(send("rotate")).toBe(true)
    expect(seen).toEqual(["a:fit", "a:rotate", "b:rotate"])
    stopA()
    stopB()
    expect(send("fit")).toBe(false)
  })
})
