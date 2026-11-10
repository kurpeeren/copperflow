import { describe, expect, test } from "vitest"
import { MENUS, menuItems } from "../studio/src/shell/menus.js"
import { readFileSync } from "node:fs"
import { TOOLBARS, ROW_FIT_WIDTH, VIEW_SLOT_RESERVE, armedCommand, drawToolCommand, buttonPressed, buttonState, hasPressedState, isToolCommand, rowWidth, titleKey, toolbarGroups, type ToolbarButton } from "../studio/src/shell/toolbar.js"
import { clearToolState, clickAction, getToolState, setToolState } from "../studio/src/shell/tool-state.js"

const ids = (view: "schematic" | "pcb") => TOOLBARS[view].map((b) => b.id)
/** The buttons that run a command; the others are pending and carry a reason. */
const working = (view: "schematic" | "pcb") => TOOLBARS[view].filter((b) => b.command !== undefined)
const menuByCommand = new Map(MENUS.flatMap(menuItems).flatMap((item) => (item.command ? [[item.command, item] as const] : [])))

describe("toolbar", () => {
  test("the schematic row is in EasyEDA's order", () => {
    expect(ids("schematic")).toEqual(["undo", "redo", "zoomIn", "zoomOut", "fit", "fitSelection", "fitArea", "gridStyle", "snap", "component", "wire", "bus", "netLabel", "ground", "power", "noConnect", "polyline", "arc", "circle", "rectangle", "text", "rotate", "rotateRight", "alignLeft", "distributeH", "checkDrc"])
    expect(toolbarGroups("schematic").map((g) => g.length)).toEqual([2, 5, 2, 7, 5, 2, 2, 1])
  })

  test("the PCB row is in EasyEDA's order", () => {
    expect(ids("pcb")).toEqual(["undo", "redo", "zoomIn", "zoomOut", "fit", "fitSelection", "fitArea", "unit", "gridStyle", "snap", "via", "boardOutline", "copperArea", "checkDrc", "singleRouting", "alignLeft", "distributeH", "rotate", "rotateRight", "gerber"])
    expect(toolbarGroups("pcb").map((g) => g.length)).toEqual([2, 5, 3, 3, 1, 1, 2, 2, 1])
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
    expect(ids("pcb")[ids("pcb").indexOf("unit") + 1]).toBe("gridStyle")
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
    for (const item of [...working("schematic"), ...working("pcb")]) expect([item.id, item.command !== undefined && menuByCommand.has(item.command)]).toEqual([item.id, true])
  })

  test("a title that names a key names the key the menu shows", () => {
    for (const item of [...working("schematic"), ...working("pcb")]) {
      expect([item.id, titleKey(item.title)]).toEqual([item.id, item.command === undefined ? "?" : menuByCommand.get(item.command)?.shortcut])
    }
  })

  test("titleKey reads the last bracketed key only", () => {
    expect(titleKey("Wire (Alt+W)")).toBe("Alt+W")
    expect(titleKey("Check DRC")).toBeUndefined()
  })
})

describe("the Align group", () => {
  const button = (id: string) => TOOLBARS.pcb.find((b) => b.id === id)
  test("both rows have Align left and Distribute horizontally, after Rotate, with the menu's keys", () => {
    for (const view of ["schematic", "pcb"] as const) {
      expect(TOOLBARS[view].find((b) => b.id === "alignLeft")).toMatchObject({ title: "Align left (Ctrl+Shift+L)", icon: "alignLeft", command: "alignLeft" })
      expect(TOOLBARS[view].find((b) => b.id === "distributeH")).toMatchObject({ title: "Distribute horizontally (Ctrl+Shift+H)", icon: "distributeH", command: "distributeH" })
    }
  })
  test("a button is disabled, with the reason in its tooltip, until enough parts are selected", () => {
    const left = button("alignLeft")
    const spread = button("distributeH")
    if (!left || !spread) throw new Error("missing buttons")
    expect(buttonState(left, 1)).toEqual({ enabled: false, title: "Align left (Ctrl+Shift+L): Select two or more parts" })
    expect(buttonState(left, 2)).toEqual({ enabled: true, title: "Align left (Ctrl+Shift+L)" })
    expect(buttonState(spread, 2)).toEqual({ enabled: false, title: "Distribute horizontally (Ctrl+Shift+H): Select three or more parts" })
    expect(buttonState(spread, 3).enabled).toBe(true)
  })
  test("other buttons ignore the selection", () => {
    const undo = button("undo")
    if (!undo) throw new Error("missing")
    expect(buttonState(undo, 0)).toEqual({ enabled: true, title: "Undo (Ctrl+Z)" })
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

describe("the view tools", () => {
  const button = (id: string) => TOOLBARS.pcb.find((b) => b.id === id)
  const need = (id: string) => {
    const found = button(id)
    if (!found) throw new Error(`no ${id} button`)
    return found
  }

  test("Fit selection and Fit area sit beside Fit all, in both rows, and run the View menu's items", () => {
    for (const view of ["schematic", "pcb"] as const) {
      const ids = TOOLBARS[view].map((b) => b.id)
      expect(ids.slice(ids.indexOf("fit"), ids.indexOf("fit") + 3)).toEqual(["fit", "fitSelection", "fitArea"])
    }
    expect(menuByCommand.get("fitSelection")?.label).toBe("Fit selection")
    expect(menuByCommand.get("fitArea")?.label).toBe("Fit area")
  })

  test("Rotate right sits beside Rotate and has no key", () => {
    for (const view of ["schematic", "pcb"] as const) {
      const ids = TOOLBARS[view].map((b) => b.id)
      expect(ids[ids.indexOf("rotate") + 1]).toBe("rotateRight")
    }
    expect(need("rotateRight").title).toBe("Rotate right")
    expect(menuByCommand.get("rotateRight")?.shortcut).toBeUndefined()
  })

  test("Fit selection and Rotate right are disabled until a part is selected, with the reason", () => {
    expect(buttonState(need("fitSelection"), 0)).toEqual({ enabled: false, title: "Fit selection: Select a part first" })
    expect(buttonState(need("fitSelection"), 1)).toEqual({ enabled: true, title: "Fit selection" })
    expect(buttonState(need("rotateRight"), 0)).toEqual({ enabled: false, title: "Rotate right: Select a part first" })
    expect(buttonState(need("rotateRight"), 3).enabled).toBe(true)
    expect(buttonState(need("fitArea"), 0).enabled).toBe(true)
  })

  test("Snap is a switch in the grid group: pressed while snap is on, with Alt+S in its title and the menu item", () => {
    expect(need("snap")).toMatchObject({ title: "Snap (Alt+S)", icon: "snap", command: "snap", group: need("gridStyle").group })
    expect(menuByCommand.get("snap")).toMatchObject({ label: "Snap", shortcut: "Alt+S", toggle: "snap" })
    expect(buttonPressed("snap", null, { snap: true, hoverLabels: true, themeLight: true, themeDark: false })).toBe(true)
    expect(buttonPressed("snap", "fitArea", { snap: false, hoverLabels: true, themeLight: true, themeDark: false })).toBe(false)
    expect(hasPressedState("snap")).toBe(true)
  })

  test("Fit area shows pressed while its tool is armed and a second click puts it away", () => {
    expect(isToolCommand("fitArea")).toBe(true)
    expect(buttonPressed("fitArea", "fitArea", { snap: true, hoverLabels: true, themeLight: true, themeDark: false })).toBe(true)
    expect(buttonPressed("fitArea", null, { snap: true, hoverLabels: true, themeLight: true, themeDark: false })).toBe(false)
    expect(clickAction("fitArea", { active: "fitArea", stop: () => {} })).toBe("stop")
    expect(hasPressedState("fit")).toBe(false)
  })
})

describe("the drawing tools", () => {
  test("Bus sits beside Wire with its key and shows pressed while armed", () => {
    expect(TOOLBARS.schematic.find((b) => b.id === "bus")).toMatchObject({ title: "Bus (Alt+B)", icon: "bus", command: "drawBus", group: 3 })
    expect([isToolCommand("drawBus"), clickAction("drawBus", { active: "drawBus", stop: () => {} })]).toEqual([true, "stop"])
  })

  test("the schematic row has the five drawing tools after the wire and label group, with their keys", () => {
    const shown = TOOLBARS.schematic.filter((b) => ["polyline", "arc", "circle", "rectangle", "text"].includes(b.id))
    expect(shown.map((b) => [b.title, b.icon, b.command])).toEqual([
      ["Polyline (Alt+L)", "polyline", "drawPolyline"],
      ["Arc (Alt+A)", "arc", "drawArc"],
      ["Circle (Alt+C)", "circle", "drawCircle"],
      ["Rectangle (Alt+R)", "rectangle", "drawRectangle"],
      ["Text (Alt+T)", "text", "drawText"],
    ])
    expect(TOOLBARS.pcb.some((b) => b.command?.startsWith("draw"))).toBe(false)
  })

  test("each shows pressed while armed, and a second click puts it away", () => {
    for (const command of ["drawPolyline", "drawArc", "drawCircle", "drawRectangle", "drawText"] as const) {
      expect([command, isToolCommand(command), buttonPressed(command, command, { snap: true, hoverLabels: true, themeLight: true, themeDark: false })]).toEqual([command, true, true])
      expect(clickAction(command, { active: command, stop: () => {} })).toBe("stop")
    }
    expect(drawToolCommand("polyline")).toBe("drawPolyline")
    expect(drawToolCommand("bus")).toBe("drawBus")
    expect(drawToolCommand("text")).toBe("drawText")
    expect(drawToolCommand(null)).toBeNull()
  })
})

const PENDING_STAGE = /\(engine stage \d\)/
type Pending = ToolbarButton & { pending: string }
const pendingOf = (view: "schematic" | "pcb"): Pending[] => TOOLBARS[view].filter((b): b is Pending => b.pending !== undefined)

describe("the pending buttons", () => {
  test("the schematic waits only on the No connect flag; the PCB on Board outline, Copper area and Gerber", () => {
    expect(pendingOf("schematic").map((b) => b.id)).toEqual(["noConnect"])
    expect(pendingOf("pcb").map((b) => b.id)).toEqual(["boardOutline", "copperArea", "gerber"])
  })

  test("Via and Single routing run the Route menu's tools, with their keys, and show pressed while armed", () => {
    expect(TOOLBARS.pcb.find((b) => b.id === "via")).toEqual({ id: "via", title: "Via (Alt+V)", icon: "via", command: "placeVia", group: 3 })
    expect(TOOLBARS.pcb.find((b) => b.id === "singleRouting")).toEqual({ id: "singleRouting", title: "Single routing (Alt+W)", icon: "singleRouting", command: "singleRouting", group: 5 })
    expect(isToolCommand("singleRouting") && isToolCommand("placeVia")).toBe(true)
  })

  test("every pending button has an icon, no command, and a reason that names the engine stage it waits for", () => {
    for (const item of [...pendingOf("schematic"), ...pendingOf("pcb")]) {
      expect([item.id, item.command, item.icon !== undefined, PENDING_STAGE.test(item.pending)]).toEqual([item.id, undefined, true, true])
    }
  })

  test("routing and copper wait for hand routing (stage 4), Gerber for fabrication outputs (stage 6), the flag for blocks and sheets (stage 3)", () => {
    const reason = (id: string) => pendingOf("pcb").find((b) => b.id === id)?.pending
    for (const id of ["boardOutline", "copperArea"]) expect(reason(id)).toBe("Comes with hand routing (engine stage 4)")
    expect(reason("gerber")).toBe("Comes with fabrication outputs (engine stage 6)")
    expect(pendingOf("schematic")[0]?.pending).toBe("Comes with blocks and sheets (engine stage 3)")
  })

  test("a pending button is disabled whatever is selected, and its tooltip carries the reason", () => {
    const outline = pendingOf("pcb").find((b) => b.id === "boardOutline")
    if (!outline) throw new Error("no Board outline button")
    expect(buttonState(outline, 5)).toEqual({ enabled: false, title: "Board outline: Comes with hand routing (engine stage 4)" })
    expect(hasPressedState("undo")).toBe(false)
  })

  test("a pending button that has a menu item of the same name says the same thing", () => {
    const byLabel = new Map(MENUS.flatMap(menuItems).map((item) => [item.label.toLowerCase(), item] as const))
    let matched = 0
    for (const item of [...pendingOf("schematic"), ...pendingOf("pcb")]) {
      const entry = byLabel.get(item.title.toLowerCase())
      if (!entry) continue
      matched++
      expect([item.id, entry.pending]).toEqual([item.id, item.pending])
    }
    expect(matched).toBeGreaterThanOrEqual(2)
  })

  test("no text in the menus or the toolbar names a round", () => {
    for (const file of ["menus.ts", "toolbar.ts"]) {
      const source = readFileSync(new URL(`../studio/src/shell/${file}`, import.meta.url), "utf8")
      expect([file, /\bround\s+(\d|N\b)/i.test(source)]).toEqual([file, false])
    }
  })
})

describe("the row at 1280 px", () => {
  test("each row, with room kept for the canvas's own tools, fits in one row", () => {
    for (const view of ["schematic", "pcb"] as const) {
      expect([view, rowWidth(view) + VIEW_SLOT_RESERVE <= ROW_FIT_WIDTH]).toEqual([view, true])
    }
  })

  test("the width counts 24px buttons, 2px gaps, 13px separators and the 16px padding", () => {
    const two: ToolbarButton[] = [
      { id: "a", title: "A", icon: "undo", command: "undo", group: 0 },
      { id: "b", title: "B", icon: "redo", command: "redo", group: 1 },
    ]
    // padding, two buttons, the gaps either side of the separator, the separator itself.
    expect(rowWidth("schematic", two)).toBe(16 + 2 * 24 + 2 * 2 + 13)
  })
})
