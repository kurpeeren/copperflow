// The menu bar as data: EasyEDA Pro's menus, the items Studio can run, and the items still to come, each with the
// engine stage (docs/engine-design.md) that brings it, or "later". The keys beside a command are the keys
// canvas-keys.ts binds; a test holds them together.
import type { AlignCommand } from "../pcb/align-rules.js"
import type { KeyActionName } from "../pcb/canvas-keys.js"
import type { View } from "../pcb/positions.js"
import { commandDisabledReason } from "../pcb/selection-rules.js"
import { WAITS_FOR_ENGINE } from "./pending.js"

export type CommandId =
  | "openFile"
  | "exportBom"
  | "exportPackage"
  | "exportFabrication"
  | "undo"
  | "redo"
  | "delete"
  | "selectAll"
  | "selectInstance"
  | "replicateLayout"
  | "makeSheet"
  | "fit"
  | "fitSelection"
  | "fitArea"
  | "snap"
  | "hoverLabels"
  | "zoomIn"
  | "zoomOut"
  | "toggleUnit"
  | "gridStyle"
  | "themeLight"
  | "themeDark"
  | "toggleLeftPanel"
  | "toggleRightPanel"
  | "toggleBottomPanel"
  | "placeComponent"
  | "wire"
  | "netLabel"
  | "groundFlag"
  | "powerFlag"
  | "noteBox"
  | "drawBus"
  | "drawPolyline"
  | "drawArc"
  | "drawCircle"
  | "drawRectangle"
  | "drawText"
  | "singleRouting"
  | "placeVia"
  | "placePour"
  | "placePourBoard"
  | "placeHole"
  | "pourSolid"
  | "pourHatched"
  | "pourOutline"
  | "autoplace"
  | "autoplaceSelection"
  | "autoplaceInstance"
  | "fitBoard"
  | "autoroute"
  | "autorouteSelection"
  | "autorouteNet"
  | "unroute"
  | "checkDrc"
  | "highlight"
  | "clearHighlight"
  | "rotate"
  | "rotateRight"
  | "removeCorners"
  | "filletTracks"
  | "straightenTracks"
  | "designRules"
  | "tidySheet"
  | "addPage"
  | "renamePage"
  | "deletePage"
  | AlignCommand
  | "find"
  | "lock"
  | "unlock"
  | "history"
  | "keys"
  | "about"
  | "newCircuit"
  | "print"
  | "exportPdf"
  | "copy"
  | "paste"
  | "findSimilar"
  | "noConnect"
  | "junction"
  | "annotate"
  | "placementTransfer"
  | "routingCorner"
  | "flip"
  | "footprintManager"
  | "systemSettings"

export interface MenuItem {
  label: string
  /** As shown, e.g. `Alt+W`. */
  shortcut?: string
  command?: CommandId
  /** Why the item cannot run yet. */
  pending?: string
  /** The one view the item works in; in the other it shows disabled. */
  only?: View
  /** A setting the item switches: the menu shows a check beside it while the setting is on. */
  toggle?: ToggleId
}

/** The settings a menu item or toolbar button can switch and show. */
export type ToggleId = "snap" | "hoverLabels" | "themeLight" | "themeDark" | "pourSolid" | "pourHatched" | "pourOutline"
export type Toggles = Readonly<Record<ToggleId, boolean>>

export type MenuEntry = MenuItem | "separator"

export interface Menu {
  title: string
  entries: MenuEntry[]
}

const run = (label: string, command: CommandId, shortcut?: string): MenuItem => (shortcut ? { label, command, shortcut } : { label, command })
const later = (label: string, pending: string, shortcut?: string): MenuItem => (shortcut ? { label, pending, shortcut } : { label, pending })
const SOON = "Comes later; not in Studio yet"

export const ENGINE = WAITS_FOR_ENGINE

export const MENUS: readonly Menu[] = [
  {
    title: "File",
    entries: [
      run("Open circuit file", "openFile", "Ctrl+O"),
      later("New circuit…", SOON),
      "separator",
      run("Export BOM", "exportBom"),
      run("Export package", "exportPackage"),
      run("Export Gerber", "exportFabrication"),
      later("Print…", SOON),
    ],
  },
  {
    title: "Edit",
    entries: [
      run("Undo", "undo", "Ctrl+Z"),
      run("Redo", "redo", "Ctrl+Y"),
      "separator",
      later("Copy", SOON, "Ctrl+C"),
      later("Paste", SOON, "Ctrl+V"),
      run("Delete", "delete", "Delete"),
      "separator",
      run("Select all", "selectAll", "Ctrl+A"),
      run("Select the instance", "selectInstance"),
      { label: "Make sub-sheet…", command: "makeSheet", only: "schematic" },
      run("Find", "find", "Ctrl+F"),
      run("Find similar objects", "findSimilar", "Ctrl+Shift+F"),
      "separator",
      run("Fillet tracks", "filletTracks", "U"),
      run("Straighten tracks", "straightenTracks", "Shift+U"),
    ],
  },
  {
    title: "View",
    entries: [
      run("Fit all", "fit", "K"),
      run("Fit selection", "fitSelection"),
      run("Fit area", "fitArea"),
      run("Zoom in", "zoomIn"),
      run("Zoom out", "zoomOut"),
      "separator",
      { ...run("Unit", "toggleUnit", "Q"), only: "pcb" },
      run("Grid style", "gridStyle"),
      { ...run("Snap", "snap", "Alt+S"), toggle: "snap" },
      { ...run("Hover labels", "hoverLabels"), toggle: "hoverLabels" },
      { ...run("Pour fill: Solid", "pourSolid"), toggle: "pourSolid" },
      { ...run("Pour fill: Hatched", "pourHatched"), toggle: "pourHatched" },
      { ...run("Pour fill: Outline only", "pourOutline"), toggle: "pourOutline" },
      "separator",
      run("Left panel", "toggleLeftPanel", "["),
      run("Right panel", "toggleRightPanel", "]"),
      run("Bottom panel", "toggleBottomPanel", "\\"),
      "separator",
      { ...run("Theme: Light", "themeLight"), toggle: "themeLight" },
      { ...run("Theme: Dark", "themeDark"), toggle: "themeDark" },
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
      run("Note box", "noteBox"),
      "separator",
      run("Bus", "drawBus", "Alt+B"),
      { label: "No connect flag", command: "noConnect", only: "schematic" },
      { label: "Junction", command: "junction", shortcut: "Alt+J", only: "schematic" },
      "separator",
      run("Copper pour", "placePour"),
      run("Copper pour: Whole board", "placePourBoard"),
      run("Hole", "placeHole"),
      "separator",
      { label: "Autoplace", command: "autoplace", only: "pcb" },
      { label: "Autoplace selection", command: "autoplaceSelection", only: "pcb" },
      { label: "Autoplace instance", command: "autoplaceInstance", only: "pcb" },
      "separator",
      run("Polyline", "drawPolyline", "Alt+L"),
      run("Arc", "drawArc", "Alt+A"),
      run("Circle", "drawCircle", "Alt+C"),
      run("Rectangle", "drawRectangle", "Alt+R"),
      run("Text", "drawText", "Alt+T"),
    ],
  },
  {
    title: "Design",
    entries: [
      run("Check DRC", "checkDrc"),
      run("Design rules", "designRules"),
      "separator",
      run("Highlight net", "highlight", "H"),
      run("Clear highlight", "clearHighlight", "Shift+H"),
      "separator",
      { label: "Add page", command: "addPage", only: "schematic" },
      { label: "Rename page", command: "renamePage", only: "schematic" },
      { label: "Delete page", command: "deletePage", only: "schematic" },
      "separator",
      { label: "Replicate layout", command: "replicateLayout", only: "pcb" },
      run("Annotate designators", "annotate"),
      { label: "Placement transfer", command: "placementTransfer", shortcut: "Ctrl+Shift+X", only: "pcb" },
    ],
  },
  {
    title: "Route",
    entries: [
      run("Single routing", "singleRouting", "Alt+W"),
      run("Via", "placeVia", "Alt+V"),
      { label: "Routing corner", command: "routingCorner", shortcut: "L", only: "pcb" },
      "separator",
      run("Autoroute", "autoroute"),
      run("Autoroute selection", "autorouteSelection"),
      run("Autoroute net", "autorouteNet"),
      run("Unroute", "unroute"),
    ],
  },
  {
    title: "Layout",
    entries: [
      run("Rotate", "rotate", "Space"),
      run("Rotate right", "rotateRight"),
      { label: "Flip", command: "flip", shortcut: "X", only: "pcb" },
      "separator",
      run("Lock", "lock"),
      run("Unlock", "unlock"),
      "separator",
      run("Align left", "alignLeft", "Ctrl+Shift+L"),
      run("Align right", "alignRight"),
      run("Align top", "alignTop"),
      run("Align bottom", "alignBottom"),
      run("Align horizontal centres", "alignHCentres"),
      run("Align vertical centres", "alignVCentres"),
      "separator",
      run("Distribute horizontally", "distributeH", "Ctrl+Shift+H"),
      run("Distribute vertically", "distributeV"),
      "separator",
      { label: "Fit board", command: "fitBoard", only: "pcb" },
      "separator",
      { label: "Tidy sheet", command: "tidySheet", only: "schematic" },
    ],
  },
  {
    title: "Tools",
    entries: [run("History", "history"), later("Footprint manager…", SOON)],
  },
  {
    title: "Export",
    entries: [run("BOM", "exportBom"), run("Package", "exportPackage"), run("Fabrication files (JLCPCB)", "exportFabrication"), run("Gerber", "exportFabrication"), run("Pick and place (CPL)", "exportFabrication"), later("PDF…", SOON)],
  },
  {
    title: "Settings",
    entries: [later("System…", SOON), run("Hotkeys", "keys")],
  },
  {
    title: "Help",
    entries: [run("Keys", "keys"), run("About", "about")],
  },
]

export const MENU_TITLES: readonly string[] = MENUS.map((menu) => menu.title)

const ONLY_REASON: Record<View, string> = { pcb: "PCB only", schematic: "Schematic only" }

/** Commands the app has turned off for now, each with the reason, such as Tidy sheet with nothing placed by Studio. */
export type CommandsOff = Partial<Record<CommandId, string>>

/**
 * Whether an item runs in the open view with `selected` parts selected, and the tooltip that says why it does not.
 * Without a count the selection is not considered. A command in `off` is disabled with its reason.
 */
export function itemState(item: MenuItem, view: View, selected?: number, off: CommandsOff = {}): { enabled: boolean; reason?: string } {
  if (!item.command) return item.pending ? { enabled: false, reason: item.pending } : { enabled: false }
  if (item.only && item.only !== view) return { enabled: false, reason: ONLY_REASON[item.only] }
  const why = off[item.command]
  if (why !== undefined) return { enabled: false, reason: why }
  const short = selected === undefined ? null : commandDisabledReason(item.command, selected)
  return short ? { enabled: false, reason: short } : { enabled: true }
}

export function menuItems(menu: Menu): MenuItem[] {
  return menu.entries.filter((entry): entry is MenuItem => entry !== "separator")
}

/** The key action that does what each keyed command does; a test checks the shown shortcut against it. */
export const COMMAND_KEY_ACTIONS: Partial<Record<CommandId, KeyActionName>> = {
  undo: "undo",
  redo: "redo",
  openFile: "openFile",
  fit: "fit",
  toggleUnit: "toggleUnit",
  toggleLeftPanel: "toggleLeftPanel",
  toggleRightPanel: "toggleRightPanel",
  toggleBottomPanel: "toggleBottomPanel",
  placeComponent: "openLibrary",
  wire: "wire",
  netLabel: "armNetLabel",
  drawBus: "drawBus",
  drawPolyline: "drawPolyline",
  drawArc: "drawArc",
  drawCircle: "drawCircle",
  drawRectangle: "drawRectangle",
  drawText: "drawText",
  singleRouting: "route",
  placeVia: "placeVia",
  highlight: "highlight",
  clearHighlight: "clearHighlight",
  rotate: "rotate",
  snap: "toggleSnap",
  selectAll: "selectAll",
  find: "find",
  delete: "delete",
  alignLeft: "alignLeft",
  distributeH: "distributeH",
  filletTracks: "filletTracks",
  straightenTracks: "straightenTracks",
  routingCorner: "routingCorner",
  flip: "flip",
  copy: "copy",
  paste: "paste",
  findSimilar: "findSimilar",
  junction: "junction",
  placementTransfer: "placementTransfer",
}

/** Keys that no menu item shows: the canvas keys, and the second key of a command. */
const EXTRA_KEYS = [
  { keys: "Ctrl+Shift+Z", label: "Redo" },
  { keys: "W", label: "Wire (schematic), Single routing (PCB)" },
  { keys: "V (PCB)", label: "Change the active layer; while routing, a via at the last corner" },
  { keys: "Space (while routing)", label: "Step the corner mode: 45°, 45° reversed, 90°, arc" },
  { keys: "Enter (while routing)", label: "End the track open at its last corner (or click that corner again)" },
  { keys: "R", label: "Rotate" },
  { keys: "Space (while drawing a wire)", label: "Flip the bend of the leg to the pointer" },
  { keys: "Shift (while drawing a polyline)", label: "Keep the leg horizontal or vertical; Space flips its bend" },
  { keys: "Enter (while drawing a polyline)", label: "Finish the polyline (or double click)" },
  { keys: "Backspace (while drawing)", label: "Remove the last corner" },
  { keys: "F", label: "Fit all" },
  { keys: "Esc", label: "Clear the selection, put tools away" },
  { keys: "Arrow keys", label: "Move the selection one grid step (a tenth with Snap off)" },
  { keys: "Shift+Arrow keys", label: "Move the selection ten grid steps (ten tenths with Snap off)" },
  { keys: "Shift+F10", label: "Open the context menu (also the menu key)" },
]

/** Every shortcut of a working command, once, then the keys no menu item shows: the Help → Keys list. */
export function shortcutList(): { keys: string; label: string }[] {
  const seen = new Set<string>()
  const rows: { keys: string; label: string }[] = []
  for (const item of MENUS.flatMap(menuItems)) {
    if (!item.command || !item.shortcut || seen.has(item.shortcut)) continue
    seen.add(item.shortcut)
    rows.push({ keys: item.shortcut, label: item.label })
  }
  return [...rows, ...EXTRA_KEYS.filter((row) => !seen.has(row.keys))]
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
export function menuShapes(view: View, selected?: number, off: CommandsOff = {}): readonly (readonly ("item" | "disabled" | "separator")[])[] {
  return MENUS.map((menu) => menu.entries.map((entry) => (entry === "separator" ? "separator" : itemState(entry, view, selected, off).enabled ? "item" : "disabled")))
}
