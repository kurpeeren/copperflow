import { describe, expect, test } from "vitest"
import { dialogKey, trapStep } from "../studio/src/shell/dialog-keys.js"
import { createKeyGate } from "../studio/src/shell/key-gate.js"
import { firstMenuItem, menuKey, type MenuShape } from "../studio/src/shell/menu-keys.js"
import { MENUS, menuReducer, menuShapes } from "../studio/src/shell/menus.js"

// Three menus: [item, separator, item, item], [separator, item], [item].
const SHAPES: MenuShape[] = [["item", "separator", "item", "item"], ["separator", "item"], ["item"]]
const title = (menu: number) => ({ menu, item: null })
const item = (menu: number, at: number) => ({ menu, item: at })

describe("menu bar keys on a title", () => {
  test("Left and Right move between the titles, wrapping, and keep a closed bar closed", () => {
    expect(menuKey("ArrowRight", title(0), null, SHAPES)).toEqual({ open: null, focus: title(1), preventDefault: true })
    expect(menuKey("ArrowRight", title(2), null, SHAPES)?.focus).toEqual(title(0))
    expect(menuKey("ArrowLeft", title(0), null, SHAPES)?.focus).toEqual(title(2))
    expect(menuKey("Home", title(2), null, SHAPES)?.focus).toEqual(title(0))
    expect(menuKey("End", title(0), null, SHAPES)?.focus).toEqual(title(2))
  })

  test("with a menu open, Left and Right switch the open menu", () => {
    expect(menuKey("ArrowRight", title(0), 0, SHAPES)).toEqual({ open: 1, focus: title(1), preventDefault: true })
  })

  test("Down opens the menu at its first item, Up at its last, skipping separators", () => {
    expect(menuKey("ArrowDown", title(1), null, SHAPES)).toEqual({ open: 1, focus: item(1, 1), preventDefault: true })
    expect(menuKey("ArrowUp", title(0), null, SHAPES)).toEqual({ open: 0, focus: item(0, 3), preventDefault: true })
  })

  test("Enter and Space are the title's own click; Esc and Tab do nothing while the bar is closed", () => {
    for (const key of ["Enter", " ", "Escape", "Tab", "r"]) expect([key, menuKey(key, title(0), null, SHAPES)]).toEqual([key, null])
  })
})

describe("menu bar keys in an open menu", () => {
  test("Down and Up step through the items, skip separators and wrap", () => {
    expect(menuKey("ArrowDown", item(0, 0), 0, SHAPES)?.focus).toEqual(item(0, 2))
    expect(menuKey("ArrowDown", item(0, 3), 0, SHAPES)?.focus).toEqual(item(0, 0))
    expect(menuKey("ArrowUp", item(0, 2), 0, SHAPES)?.focus).toEqual(item(0, 0))
    expect(menuKey("ArrowUp", item(0, 0), 0, SHAPES)?.focus).toEqual(item(0, 3))
    expect(menuKey("ArrowDown", item(2, 0), 2, SHAPES)?.focus).toEqual(item(2, 0))
  })

  test("Home and End jump to the first and the last item", () => {
    expect(menuKey("Home", item(0, 3), 0, SHAPES)?.focus).toEqual(item(0, 0))
    expect(menuKey("End", item(0, 0), 0, SHAPES)?.focus).toEqual(item(0, 3))
  })

  test("Left and Right open the next menu at its first item", () => {
    expect(menuKey("ArrowRight", item(0, 2), 0, SHAPES)).toEqual({ open: 1, focus: item(1, 1), preventDefault: true })
    expect(menuKey("ArrowLeft", item(0, 2), 0, SHAPES)).toEqual({ open: 2, focus: item(2, 0), preventDefault: true })
  })

  test("Esc closes the menu and goes back to its title", () => {
    expect(menuKey("Escape", item(1, 1), 1, SHAPES)).toEqual({ open: null, focus: title(1), preventDefault: true })
  })

  test("Tab closes the menu from its title, so the focus moves on out of the bar", () => {
    expect(menuKey("Tab", item(1, 1), 1, SHAPES)).toEqual({ open: null, focus: title(1), preventDefault: false })
  })

  test("Enter and Space are the item's own click", () => {
    expect(menuKey("Enter", item(0, 0), 0, SHAPES)).toBeNull()
    expect(menuKey(" ", item(0, 0), 0, SHAPES)).toBeNull()
  })
})

describe("menu bar keys with disabled items", () => {
  // [disabled, item, separator, disabled] and a menu with no enabled item at all.
  const shapes: MenuShape[] = [["disabled", "item", "separator", "disabled"], ["disabled", "disabled"]]

  test("Down, Enter or Space open at the first enabled item, Up at the last enabled one", () => {
    expect(menuKey("ArrowDown", title(0), null, shapes)?.focus).toEqual(item(0, 1))
    expect(menuKey("ArrowUp", title(0), null, shapes)?.focus).toEqual(item(0, 1))
    expect(firstMenuItem(shapes[0])).toBe(1)
  })

  test("a menu with no enabled item opens at its first item", () => {
    expect(menuKey("ArrowDown", title(1), null, shapes)?.focus).toEqual(item(1, 0))
    expect(firstMenuItem(shapes[1])).toBe(0)
  })

  test("in an open menu the disabled items take the focus too", () => {
    expect(menuKey("ArrowDown", item(0, 1), 0, shapes)?.focus).toEqual(item(0, 3))
    expect(menuKey("ArrowDown", item(0, 3), 0, shapes)?.focus).toEqual(item(0, 0))
  })
})

describe("menu bar keys while the focus is outside the bar", () => {
  test("nothing is ours while no menu is open", () => {
    expect(menuKey("ArrowDown", null, null, SHAPES)).toBeNull()
  })

  test("a menu opened with the mouse closes on Esc and takes the focus on Down or Up", () => {
    expect(menuKey("Escape", null, 0, SHAPES)).toEqual({ open: null, focus: "keep", preventDefault: true })
    expect(menuKey("ArrowDown", null, 0, SHAPES)?.focus).toEqual(item(0, 0))
    expect(menuKey("ArrowUp", null, 0, SHAPES)?.focus).toEqual(item(0, 3))
    expect(menuKey("Tab", null, 0, SHAPES)).toEqual({ open: null, focus: "keep", preventDefault: false })
  })
})

describe("the real menus", () => {
  test("every menu opens at an item, never at a separator", () => {
    for (const view of ["pcb", "schematic"] as const) {
      for (const [i, shape] of menuShapes(view).entries()) {
        const first = firstMenuItem(shape)
        expect([view, MENUS[i]?.title, first !== null && MENUS[i]?.entries[first] !== "separator"]).toEqual([view, MENUS[i]?.title, true])
      }
    }
  })

  test("a menu opens at its first enabled item; Route and Settings, with none, at their first", () => {
    const opening = (title: string) => {
      const i = MENUS.findIndex((m) => m.title === title)
      const at = firstMenuItem(menuShapes("schematic")[i])
      const entry = at === null ? undefined : MENUS[i]?.entries[at]
      return entry === "separator" ? "separator" : entry?.label
    }
    expect(opening("File")).toBe("Open circuit file")
    expect(opening("Route")).toBe("Single routing")
    expect(opening("Settings")).toBe("System")
  })

  test("on the schematic, Unit is a disabled stop in View; on the PCB it runs", () => {
    const view = MENUS.findIndex((m) => m.title === "View")
    const unit = MENUS[view]?.entries.findIndex((e) => e !== "separator" && e.command === "toggleUnit") ?? -1
    expect(menuShapes("schematic")[view]?.[unit]).toBe("disabled")
    expect(menuShapes("pcb")[view]?.[unit]).toBe("item")
  })

  test("a key sets the open menu; setting the same one changes nothing", () => {
    const open = { open: "File" }
    expect(menuReducer({ open: null }, { type: "set", title: "Edit" })).toEqual({ open: "Edit" })
    expect(menuReducer(open, { type: "set", title: "File" })).toBe(open)
    expect(menuReducer(open, { type: "set", title: null })).toEqual({ open: null })
  })
})

describe("key gate", () => {
  const press = () => {
    const seen = { stopped: 0 }
    return { seen, event: { stopImmediatePropagation: () => void seen.stopped++ } }
  }

  test("with nobody holding the keys a press goes on as usual", () => {
    const gate = createKeyGate()
    const { seen, event } = press()
    expect(gate.dispatch(event)).toBe(false)
    expect(seen.stopped).toBe(0)
  })

  test("the newest holder sees the press, which then goes no further", () => {
    const gate = createKeyGate()
    const calls: string[] = []
    const releaseMenu = gate.hold(() => calls.push("menu"))
    const releaseDialog = gate.hold(() => calls.push("dialog"))
    const { seen, event } = press()
    expect(gate.dispatch(event)).toBe(true)
    expect(calls).toEqual(["dialog"])
    expect(seen.stopped).toBe(1)
    releaseDialog()
    gate.dispatch(event)
    expect(calls).toEqual(["dialog", "menu"])
    releaseMenu()
    expect(gate.held()).toBe(false)
  })

  test("letting go twice, or out of order, leaves the others holding", () => {
    const gate = createKeyGate()
    const releaseA = gate.hold(() => undefined)
    const releaseB = gate.hold(() => undefined)
    releaseA()
    releaseA()
    expect(gate.held()).toBe(true)
    releaseB()
    expect(gate.held()).toBe(false)
  })
})

describe("dialog keys", () => {
  test("Esc closes, Tab goes round, everything else stays in the dialog", () => {
    expect(dialogKey("Escape")).toBe("close")
    expect(dialogKey("Tab")).toBe("trap")
    for (const key of ["r", "Delete", "[", "]", "\\", "z", " ", "w"]) expect([key, dialogKey(key)]).toEqual([key, "hold"])
  })

  test("Tab wraps from the last control to the first, Shift+Tab the other way", () => {
    expect(trapStep(0, 3, false)).toBe(1)
    expect(trapStep(2, 3, false)).toBe(0)
    expect(trapStep(0, 3, true)).toBe(2)
    expect(trapStep(1, 1, false)).toBe(0)
  })

  test("from outside the controls Tab goes to the first and Shift+Tab to the last; with none there is nowhere", () => {
    expect(trapStep(-1, 3, false)).toBe(0)
    expect(trapStep(-1, 3, true)).toBe(2)
    expect(trapStep(-1, 0, false)).toBe(-1)
  })
})
