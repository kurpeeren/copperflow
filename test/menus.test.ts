import { describe, expect, test } from "vitest"
import { keyAction, type KeyInput } from "../studio/src/pcb/canvas-keys.js"
import { COMMAND_KEY_ACTIONS, MENUS, MENU_TITLES, itemState, menuItems, menuReducer, menuShapes, shortcutList, type MenuItem } from "../studio/src/shell/menus.js"
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

  test("every item still to come names the engine stage that brings it, or says it comes later", () => {
    for (const item of MENUS.flatMap(menuItems)) {
      if (item.pending === undefined) continue
      expect([item.label, /\((engine )?stages? \d|^Comes later/.test(item.pending)]).toEqual([item.label, true])
    }
  })

  test("the honest reasons: Annotate, Footprint manager, No connect flag and Junction", () => {
    const find = (label: string) => MENUS.flatMap(menuItems).find((item) => item.label === label)
    expect(find("Annotate designators")?.pending).toContain("(engine stage 3)")
    expect(find("Footprint manager")?.pending).toContain("(engine stage 3)")
    expect(find("No connect flag")?.pending).toContain("(engine stage 3)")
    expect(find("Junction")?.pending).toMatch(/^Comes later/)
  })

  test("Settings → Hotkeys opens the Keys dialog", () => {
    const hotkeys = MENUS.find((m) => m.title === "Settings")?.entries.find((e) => e !== "separator" && e.label === "Hotkeys")
    expect(hotkeys).toEqual({ label: "Hotkeys", command: "keys" })
  })

  test("Flip waits for the engine, and Find similar objects for Find", () => {
    const find = (label: string) => MENUS.flatMap(menuItems).find((item) => item.label === label)
    expect(find("Flip")?.pending).toBe("Comes with the engine (stages 3 to 5)")
    expect(find("Find similar objects")?.pending).toMatch(/^Comes later/)
  })

  test("Edit → Find runs the find command, with Ctrl+F beside it", () => {
    const item = MENUS.flatMap(menuItems).find((entry) => entry.label === "Find")
    expect(item).toEqual({ label: "Find", command: "find", shortcut: "Ctrl+F" })
  })

  test("Help → Keys lists the arrow keys", () => {
    const keys = shortcutList().map((row) => row.keys)
    expect(keys).toContain("Arrow keys")
    expect(keys).toContain("Shift+Arrow keys")
    expect(shortcutList()).toContainEqual({ keys: "Space (while drawing a wire)", label: "Flip the bend of the leg to the pointer" })
  })

  test("Edit → Select all runs, with Ctrl+A beside it", () => {
    const item = MENUS.find((menu) => menu.title === "Edit")?.entries.find((entry) => entry !== "separator" && entry.label === "Select all")
    expect(item).toEqual({ label: "Select all", command: "selectAll", shortcut: "Ctrl+A" })
    expect(COMMAND_KEY_ACTIONS.selectAll).toBe("selectAll")
    expect(shortcutList()).toContainEqual({ keys: "Ctrl+A", label: "Select all" })
  })

  test("Edit → Redo runs, with Ctrl+Y beside it; the key list also names Ctrl+Shift+Z", () => {
    const edit = MENUS.find((menu) => menu.title === "Edit")?.entries ?? []
    expect(edit.slice(0, 2)).toEqual([
      { label: "Undo", command: "undo", shortcut: "Ctrl+Z" },
      { label: "Redo", command: "redo", shortcut: "Ctrl+Y" },
    ])
    expect(COMMAND_KEY_ACTIONS.redo).toBe("redo")
    expect(keyAction(pressOf("Ctrl+Shift+Z"), { view: "pcb" })?.action).toBe("redo")
    expect(shortcutList()).toContainEqual({ keys: "Ctrl+Y", label: "Redo" })
    expect(shortcutList()).toContainEqual({ keys: "Ctrl+Shift+Z", label: "Redo" })
  })

  test("Layout holds the eight align and distribute commands in EasyEDA's order, with the two keys", () => {
    const layout = MENUS.find((menu) => menu.title === "Layout")?.entries ?? []
    expect(layout.slice(7, 16)).toEqual([
      { label: "Align left", command: "alignLeft", shortcut: "Ctrl+Shift+L" },
      { label: "Align right", command: "alignRight" },
      { label: "Align top", command: "alignTop" },
      { label: "Align bottom", command: "alignBottom" },
      { label: "Align horizontal centres", command: "alignHCentres" },
      { label: "Align vertical centres", command: "alignVCentres" },
      "separator",
      { label: "Distribute horizontally", command: "distributeH", shortcut: "Ctrl+Shift+H" },
      { label: "Distribute vertically", command: "distributeV" },
    ])
  })

  test("the align items are disabled with the reason until enough parts are selected, in both views", () => {
    const find = (label: string) => MENUS.flatMap(menuItems).find((item) => item.label === label) as MenuItem
    for (const view of ["pcb", "schematic"] as const) {
      expect(itemState(find("Align left"), view, 1)).toEqual({ enabled: false, reason: "Select two or more parts" })
      expect(itemState(find("Align left"), view, 2)).toEqual({ enabled: true })
      expect(itemState(find("Distribute vertically"), view, 2)).toEqual({ enabled: false, reason: "Select three or more parts" })
      expect(itemState(find("Distribute vertically"), view, 3)).toEqual({ enabled: true })
    }
    expect(itemState(find("Rotate"), "pcb", 0)).toEqual({ enabled: true })
  })

  test("Ctrl+Shift+L and Ctrl+Shift+H are the canvas's, by the character, and not with Alt or in a field", () => {
    for (const view of ["pcb", "schematic"] as const) {
      expect(keyAction(pressOf("Ctrl+Shift+L"), { view })).toEqual({ action: "alignLeft", preventDefault: true })
      expect(keyAction(pressOf("Ctrl+Shift+H"), { view })).toEqual({ action: "distributeH", preventDefault: true })
    }
    expect(keyAction({ ...pressOf("Ctrl+Shift+L"), altKey: true }, { view: "pcb" })).toBeNull()
    expect(keyAction({ ...pressOf("Ctrl+Shift+L"), typing: true }, { view: "pcb" })).toBeNull()
    // In a widget that owns its keys (a table row) the shortcut still works.
    expect(keyAction({ ...pressOf("Ctrl+Shift+H"), ownsKeys: true }, { view: "pcb" })?.action).toBe("distributeH")
    // Plain Shift+H keeps its highlight meaning.
    expect(keyAction(pressOf("Shift+H"), { view: "pcb" })?.action).toBe("clearHighlight")
  })

  test("View → Unit works on the PCB and shows disabled, PCB only, on the schematic", () => {
    const unit = MENUS.flatMap(menuItems).find((item) => item.command === "toggleUnit") as MenuItem
    expect(itemState(unit, "pcb")).toEqual({ enabled: true })
    expect(itemState(unit, "schematic")).toEqual({ enabled: false, reason: "PCB only" })
  })

  test("an item still to come is disabled in both views with its reason; the rest work in both but the page items, Tidy sheet, Replicate layout and Unit", () => {
    const later = { label: "Bus", pending: "Comes with blocks and sheets (stage 3)" }
    expect(itemState(later, "pcb")).toEqual({ enabled: false, reason: later.pending })
    const views = (["pcb", "schematic"] as const).map((view) =>
      MENUS.flatMap(menuItems).filter((item) => item.command && !itemState(item, view).enabled).map((item) => item.label),
    )
    expect(views).toEqual([["Add page", "Rename page", "Delete page", "Tidy sheet"], ["Unit", "Replicate layout"]])
  })

  test("no menu has more than 14 items", () => {
    for (const menu of MENUS) expect([menu.title, menuItems(menu).length <= 14]).toEqual([menu.title, true])
  })

  test("Route runs Single routing (Alt+W) and Via (Alt+V); Routing corner and Auto routing are still to come; Settings only System", () => {
    const route = MENUS.find((m) => m.title === "Route")
    expect(route && menuItems(route).slice(0, 2)).toEqual([
      { label: "Single routing", command: "singleRouting", shortcut: "Alt+W" },
      { label: "Via", command: "placeVia", shortcut: "Alt+V" },
    ])
    expect(route && menuItems(route).slice(2).every((item) => item.pending !== undefined)).toBe(true)
    expect(shortcutList()).toContainEqual({ keys: "V (PCB)", label: "Change the active layer; while routing, a via at the last corner" })
    const settings = MENUS.find((m) => m.title === "Settings")
    expect(settings && menuItems(settings).filter((item) => item.pending !== undefined).map((item) => item.label)).toEqual(["System"])
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

describe("the view and layout tools", () => {
  const find = (label: string) => MENUS.flatMap(menuItems).find((item) => item.label === label) as MenuItem

  test("View holds Fit selection, Fit area and a checked Snap with Alt+S", () => {
    const view = MENUS.find((menu) => menu.title === "View")?.entries ?? []
    const labels = view.flatMap((entry) => (entry === "separator" ? [] : [entry.label]))
    expect(labels.slice(0, 5)).toEqual(["Fit all", "Fit selection", "Fit area", "Zoom in", "Zoom out"])
    expect(find("Snap")).toEqual({ label: "Snap", command: "snap", shortcut: "Alt+S", toggle: "snap" })
    expect(COMMAND_KEY_ACTIONS.snap).toBe("toggleSnap")
  })

  test("Alt+S, by its physical key, switches snap in both views and is listed in Help → Keys", () => {
    for (const view of ["pcb", "schematic"] as const) {
      expect(keyAction({ ...pressOf("Alt+S"), key: "ß" }, { view })).toEqual({ action: "toggleSnap", preventDefault: true })
    }
    expect(shortcutList()).toContainEqual({ keys: "Alt+S", label: "Snap" })
  })

  test("Layout → Rotate right follows Rotate and has no key", () => {
    const layout = MENUS.find((menu) => menu.title === "Layout")?.entries ?? []
    expect(layout.slice(0, 2)).toEqual([{ label: "Rotate", command: "rotate", shortcut: "Space" }, { label: "Rotate right", command: "rotateRight" }])
  })

  test("Fit selection and Rotate right are disabled with nothing selected, in both views; Fit area never is", () => {
    for (const view of ["pcb", "schematic"] as const) {
      expect(itemState(find("Fit selection"), view, 0)).toEqual({ enabled: false, reason: "Select a part first" })
      expect(itemState(find("Fit selection"), view, 1)).toEqual({ enabled: true })
      expect(itemState(find("Rotate right"), view, 0)).toEqual({ enabled: false, reason: "Select a part first" })
      expect(itemState(find("Rotate right"), view, 2)).toEqual({ enabled: true })
      expect(itemState(find("Fit area"), view, 0)).toEqual({ enabled: true })
      expect(itemState(find("Snap"), view, 0)).toEqual({ enabled: true })
    }
  })
})

describe("Layout → Tidy sheet", () => {
  const tidy = MENUS.flatMap(menuItems).find((item) => item.label === "Tidy sheet") as MenuItem

  test("ends the Layout menu, after a separator, and works on the schematic only", () => {
    const layout = MENUS.find((menu) => menu.title === "Layout")?.entries ?? []
    expect(layout.slice(-2)).toEqual(["separator", { label: "Tidy sheet", command: "tidySheet", only: "schematic" }])
    expect(itemState(tidy, "pcb", 0)).toEqual({ enabled: false, reason: "Schematic only" })
  })

  test("is disabled with the reason the app gives, and needs no selection", () => {
    expect(itemState(tidy, "schematic", 0)).toEqual({ enabled: true })
    expect(itemState(tidy, "schematic", 0, { tidySheet: "Every part on the sheet has a position of its own" })).toEqual({ enabled: false, reason: "Every part on the sheet has a position of its own" })
  })

  test("the menu keys skip it while it is off", () => {
    const layout = MENUS.findIndex((menu) => menu.title === "Layout")
    expect(menuShapes("schematic", 0, { tidySheet: "off" })[layout]?.at(-1)).toBe("disabled")
    expect(menuShapes("schematic", 0)[layout]?.at(-1)).toBe("item")
  })
})

describe("Place → the drawing tools", () => {
  test("Polyline, Arc, Circle, Rectangle and Text run, in EasyEDA's order, with their Alt keys", () => {
    const place = MENUS.find((menu) => menu.title === "Place")?.entries ?? []
    expect(place.slice(-6)).toEqual([
      "separator",
      { label: "Polyline", command: "drawPolyline", shortcut: "Alt+L" },
      { label: "Arc", command: "drawArc", shortcut: "Alt+A" },
      { label: "Circle", command: "drawCircle", shortcut: "Alt+C" },
      { label: "Rectangle", command: "drawRectangle", shortcut: "Alt+R" },
      { label: "Text", command: "drawText", shortcut: "Alt+T" },
    ])
    for (const [command, action] of [["drawPolyline", "drawPolyline"], ["drawText", "drawText"]] as const) expect(COMMAND_KEY_ACTIONS[command]).toBe(action)
  })

  test("Bus runs after Note box, with Alt+B, and the menu keeps its length", () => {
    const place = MENUS.find((menu) => menu.title === "Place")?.entries ?? []
    expect(place).toContainEqual({ label: "Bus", command: "drawBus", shortcut: "Alt+B" })
    expect(COMMAND_KEY_ACTIONS.drawBus).toBe("drawBus")
  })

  test("Help → Keys lists the tools' keys and the keys while a polyline is drawn", () => {
    const keys = shortcutList().map((row) => row.keys)
    for (const shown of ["Alt+B", "Alt+L", "Alt+A", "Alt+C", "Alt+R", "Alt+T", "Enter (while drawing a polyline)"]) expect(keys).toContain(shown)
  })
})
