// The menu bar as data: EasyEDA Pro's menus, the items Studio can run, and the items still to come, each with the
// engine stage (docs/engine-design.md) or the Studio round (docs/studio-easyeda-parity.md §10) that brings it. The
// keys beside a command are the keys canvas-keys.ts binds; a test holds them together.
import type { KeyActionName } from "../pcb/canvas-keys.js"
import type { View } from "../pcb/positions.js"

export type CommandId =
  | "openFile"
  | "exportBom"
  | "exportPackage"
  | "undo"
  | "delete"
  | "selectAll"
  | "fit"
  | "zoomIn"
  | "zoomOut"
  | "toggleUnit"
  | "gridStyle"
  | "toggleLeftPanel"
  | "toggleRightPanel"
  | "toggleBottomPanel"
  | "placeComponent"
  | "wire"
  | "netLabel"
  | "groundFlag"
  | "powerFlag"
  | "checkDrc"
  | "highlight"
  | "clearHighlight"
  | "rotate"
  | "lock"
  | "unlock"
  | "history"
  | "keys"
  | "about"

export interface MenuItem {
  label: string
  /** As shown, e.g. `Alt+W`. */
  shortcut?: string
  command?: CommandId
  /** Why the item cannot run yet. */
  pending?: string
  /** The one view the item works in; in the other it shows disabled. */
  only?: View
}

export type MenuEntry = MenuItem | "separator"

export interface Menu {
  title: string
  entries: MenuEntry[]
}

const run = (label: string, command: CommandId, shortcut?: string): MenuItem => (shortcut ? { label, command, shortcut } : { label, command })
const later = (label: string, pending: string, shortcut?: string): MenuItem => (shortcut ? { label, pending, shortcut } : { label, pending })

const STAGE_3 = "Comes with blocks and sheets (stage 3)"
const STAGE_4 = "Comes with routing (stage 4)"
const STAGE_5 = "Comes with the autorouter (stage 5)"
const STAGE_6 = "Comes with fabrication outputs (stage 6)"
const ENGINE = "Comes with the engine (stages 3 to 5)"
const FIND = "Comes with Find (round 3)"
const SETTINGS = "Comes in round 5, after the side-by-side check with EasyEDA"

export const MENUS: readonly Menu[] = [
  {
    title: "File",
    entries: [
      run("Open circuit file", "openFile", "Ctrl+O"),
      later("New circuit", "Comes in round 5; for now create a .circuit.tsx file in the project folder"),
      "separator",
      run("Export BOM", "exportBom"),
      run("Export package", "exportPackage"),
      later("Export Gerber", STAGE_6),
      later("Print", STAGE_6),
    ],
  },
  {
    title: "Edit",
    entries: [
      run("Undo", "undo", "Ctrl+Z"),
      later("Redo", "Comes in round 5; for now every change is kept in the Log, where it can be undone", "Ctrl+Y"),
      "separator",
      later("Copy", ENGINE, "Ctrl+C"),
      later("Paste", ENGINE, "Ctrl+V"),
      run("Delete", "delete", "Delete"),
      "separator",
      run("Select all", "selectAll", "Ctrl+A"),
      later("Find", FIND, "Ctrl+F"),
      later("Find similar objects", FIND, "Ctrl+Shift+F"),
    ],
  },
  {
    title: "View",
    entries: [
      run("Fit all", "fit", "K"),
      run("Zoom in", "zoomIn"),
      run("Zoom out", "zoomOut"),
      "separator",
      { ...run("Unit", "toggleUnit", "Q"), only: "pcb" },
      run("Grid style", "gridStyle"),
      "separator",
      run("Left panel", "toggleLeftPanel", "["),
      run("Right panel", "toggleRightPanel", "]"),
      run("Bottom panel", "toggleBottomPanel", "\\"),
    ],
  },
  {
    title: "Place",
    entries: [
      run("Component", "placeComponent", "Shift+F"),
      run("Wire", "wire", "Alt+W"),
      run("Net label", "netLabel", "Alt+N"),
      run("Ground flag", "groundFlag"),
      run("Power flag", "powerFlag"),
      "separator",
      later("Bus", STAGE_3, "Alt+B"),
      later("No connect flag", "Comes with the schematic flags (round 5)"),
      later("Junction", "Comes in round 5; for now junctions are drawn where wires meet", "Alt+J"),
      later("Text", "Comes with the drawing tools (round 5)", "Alt+T"),
    ],
  },
  {
    title: "Design",
    entries: [
      run("Check DRC", "checkDrc"),
      later("Design rules", "Comes in round 5; for now edit rules.yaml in the project"),
      "separator",
      run("Highlight net", "highlight", "H"),
      run("Clear highlight", "clearHighlight", "Shift+H"),
      "separator",
      later("Annotate designators", "Comes in round 5; for now Studio picks the next free name when placing"),
      later("Placement transfer", STAGE_3, "Ctrl+Shift+X"),
    ],
  },
  {
    title: "Route",
    entries: [
      later("Single routing", STAGE_4, "Alt+W"),
      later("Via", STAGE_4, "Alt+V"),
      later("Routing corner", STAGE_4, "L"),
      later("Auto routing", STAGE_5),
    ],
  },
  {
    title: "Layout",
    entries: [
      run("Rotate", "rotate", "Space"),
      later("Flip", ENGINE, "X"),
      "separator",
      run("Lock", "lock"),
      run("Unlock", "unlock"),
      "separator",
      later("Align left", STAGE_3, "Ctrl+Shift+L"),
      later("Distribute horizontally", STAGE_3, "Ctrl+Shift+H"),
    ],
  },
  {
    title: "Tools",
    entries: [run("History", "history"), later("Footprint manager", "Comes in round 5; for now edit footprint.yaml files in the project")],
  },
  {
    title: "Export",
    entries: [run("BOM", "exportBom"), run("Package", "exportPackage"), later("Gerber", STAGE_6), later("Pick and place (CPL)", STAGE_6), later("PDF", STAGE_6)],
  },
  {
    title: "Settings",
    entries: [later("System", SETTINGS), later("Hotkeys", SETTINGS)],
  },
  {
    title: "Help",
    entries: [run("Keys", "keys"), run("About", "about")],
  },
]

export const MENU_TITLES: readonly string[] = MENUS.map((menu) => menu.title)

const ONLY_REASON: Record<View, string> = { pcb: "PCB only", schematic: "Schematic only" }

/** Whether an item runs in the open view, and the tooltip that says why it does not. */
export function itemState(item: MenuItem, view: View): { enabled: boolean; reason?: string } {
  if (!item.command) return item.pending ? { enabled: false, reason: item.pending } : { enabled: false }
  if (item.only && item.only !== view) return { enabled: false, reason: ONLY_REASON[item.only] }
  return { enabled: true }
}

export function menuItems(menu: Menu): MenuItem[] {
  return menu.entries.filter((entry): entry is MenuItem => entry !== "separator")
}

/** The key action that does what each keyed command does; a test checks the shown shortcut against it. */
export const COMMAND_KEY_ACTIONS: Partial<Record<CommandId, KeyActionName>> = {
  undo: "undo",
  openFile: "openFile",
  fit: "fit",
  toggleUnit: "toggleUnit",
  toggleLeftPanel: "toggleLeftPanel",
  toggleRightPanel: "toggleRightPanel",
  toggleBottomPanel: "toggleBottomPanel",
  placeComponent: "openLibrary",
  wire: "wire",
  netLabel: "armNetLabel",
  highlight: "highlight",
  clearHighlight: "clearHighlight",
  rotate: "rotate",
  selectAll: "selectAll",
}

/** Keys that work on the canvases without a menu item. */
const CANVAS_KEYS = [
  { keys: "W", label: "Wire (schematic)" },
  { keys: "R", label: "Rotate" },
  { keys: "F", label: "Fit all" },
  { keys: "Esc", label: "Clear the selection, put tools away" },
]

/** Every shortcut of a working command, once, then the canvas-only keys: the Help → Keys list. */
export function shortcutList(): { keys: string; label: string }[] {
  const seen = new Set<string>()
  const rows: { keys: string; label: string }[] = []
  for (const item of MENUS.flatMap(menuItems)) {
    if (!item.command || !item.shortcut || seen.has(item.shortcut)) continue
    seen.add(item.shortcut)
    rows.push({ keys: item.shortcut, label: item.label })
  }
  return [...rows, ...CANVAS_KEYS.filter((row) => !seen.has(row.keys))]
}

export interface MenuState {
  open: string | null
}

export type MenuEvent =
  | { type: "click"; title: string }
  | { type: "hover"; title: string }
  | { type: "set"; title: string | null }
  | { type: "escape" }
  | { type: "outside" }
  | { type: "run" }

/** A click opens a menu or closes the open one; hovering switches only while one is open; a key sets the open menu; Esc, outside and run close. */
export function menuReducer(state: MenuState, event: MenuEvent): MenuState {
  switch (event.type) {
    case "click":
      return { open: state.open === event.title ? null : event.title }
    case "hover":
      return state.open === null || state.open === event.title ? state : { open: event.title }
    case "set":
      return state.open === event.title ? state : { open: event.title }
    default:
      return state.open === null ? state : { open: null }
  }
}

/** Each menu's entries as the menu keys see them in the open view: items that run, disabled items and separators. */
export function menuShapes(view: View): readonly (readonly ("item" | "disabled" | "separator")[])[] {
  return MENUS.map((menu) => menu.entries.map((entry) => (entry === "separator" ? "separator" : itemState(entry, view).enabled ? "item" : "disabled")))
}
