// The toolbar as data: the buttons of each view, in order, in groups. Each button sends the command the menu item of
// the same name sends; a title names the key in brackets, as the menu shows it. A test holds the two together.
import type { View } from "../pcb/positions.js"
import { commandDisabledReason } from "../pcb/selection-rules.js"
import { DRAW_COMMANDS, DRAW_TOOL_COMMAND } from "../pcb/draw-commands.js"
import type { DrawTool } from "../pcb/draw-tools.js"
import type { CommandId, Toggles } from "./menus.js"

export type ToolIconName = "undo" | "redo" | "zoomIn" | "zoomOut" | "fit" | "fitSelection" | "fitArea" | "component" | "wire" | "netLabel" | "ground" | "power" | "rotate" | "rotateRight" | "snap" | "check" | "grid" | "alignLeft" | "distributeH" | "polyline" | "arc" | "circle" | "rectangle" | "text" | "bus"

interface ToolbarButtonBase {
  id: string
  /** `Name (key)`, or just `Name` when the command has no key. */
  title: string
  command: CommandId
  /** Buttons with the same group number sit together; a separator goes between groups. */
  group: number
}

/** A button shows its icon, or (the PCB's Unit) the unit it switches, mm or mil, as its text. */
export type ToolbarButton = ToolbarButtonBase & ({ icon: ToolIconName; text?: undefined } | { text: "unit"; icon?: undefined })

const button = (id: string, title: string, icon: ToolIconName, command: CommandId, group: number): ToolbarButton => ({ id, title, icon, command, group })

const HISTORY = [button("undo", "Undo (Ctrl+Z)", "undo", "undo", 0), button("redo", "Redo (Ctrl+Y)", "redo", "redo", 0)]
const ZOOM = [button("zoomIn", "Zoom in", "zoomIn", "zoomIn", 1), button("zoomOut", "Zoom out", "zoomOut", "zoomOut", 1), button("fit", "Fit all (K)", "fit", "fit", 1),
  button("fitSelection", "Fit selection", "fitSelection", "fitSelection", 1),
  button("fitArea", "Fit area", "fitArea", "fitArea", 1),
]
const ROTATE = (group: number) => [button("rotate", "Rotate (Space)", "rotate", "rotate", group), button("rotateRight", "Rotate right", "rotateRight", "rotateRight", group)]
const GRID = (group: number) => [button("gridStyle", "Grid style", "grid", "gridStyle", group), button("snap", "Snap (Alt+S)", "snap", "snap", group)]
const ALIGN = (group: number) => [
  button("alignLeft", "Align left (Ctrl+Shift+L)", "alignLeft", "alignLeft", group),
  button("distributeH", "Distribute horizontally (Ctrl+Shift+H)", "distributeH", "distributeH", group),
]
const CHECK = (group: number) => button("checkDrc", "Check DRC", "check", "checkDrc", group)

export const TOOLBARS: Readonly<Record<View, readonly ToolbarButton[]>> = {
  schematic: [
    ...HISTORY,
    ...ZOOM,
    ...GRID(2),
    button("component", "Component (Shift+F)", "component", "placeComponent", 3),
    button("wire", "Wire (Alt+W)", "wire", "wire", 3),
    button("bus", "Bus (Alt+B)", "bus", "drawBus", 3),
    button("netLabel", "Net label (Alt+N)", "netLabel", "netLabel", 3),
    button("ground", "Ground flag", "ground", "groundFlag", 3),
    button("power", "Power flag", "power", "powerFlag", 3),
    button("polyline", "Polyline (Alt+L)", "polyline", "drawPolyline", 4),
    button("arc", "Arc (Alt+A)", "arc", "drawArc", 4),
    button("circle", "Circle (Alt+C)", "circle", "drawCircle", 4),
    button("rectangle", "Rectangle (Alt+R)", "rectangle", "drawRectangle", 4),
    button("text", "Text (Alt+T)", "text", "drawText", 4),
    ...ROTATE(5),
    ...ALIGN(6),
    CHECK(7),
  ],
  pcb: [...HISTORY, ...ZOOM, ...GRID(2), { id: "unit", title: "Unit (Q)", text: "unit", command: "toggleUnit", group: 2 }, ...ROTATE(3), ...ALIGN(4), CHECK(5)],
}

/** Whether a button runs with `selected` parts selected, and its tooltip: the title, with the reason after it when it cannot. */
export function buttonState(item: ToolbarButton, selected: number): { enabled: boolean; title: string } {
  const reason = commandDisabledReason(item.command, selected)
  return reason ? { enabled: false, title: `${item.title}: ${reason}` } : { enabled: true, title: item.title }
}

/** The buttons of a view split into its groups, in order. */
export function toolbarGroups(view: View): ToolbarButton[][] {
  const groups: ToolbarButton[][] = []
  for (const item of TOOLBARS[view]) {
    const last = groups.at(-1)
    if (last && last[0]?.group === item.group) last.push(item)
    else groups.push([item])
  }
  return groups
}

/** The key a title names in brackets, if it names one. */
export function titleKey(title: string): string | undefined {
  return /\(([^()]+)\)$/.exec(title)?.[1]
}

/** The commands that switch a tool on and stay on until it is put away. */
const TOOL_COMMANDS: ReadonlySet<CommandId> = new Set(["wire", "netLabel", "groundFlag", "powerFlag", "fitArea", ...DRAW_COMMANDS])

export function isToolCommand(command: CommandId): boolean {
  return TOOL_COMMANDS.has(command)
}

/** The setting a button shows pressed while it is on, if it is a switch. */
const TOGGLE_OF_COMMAND: Partial<Record<CommandId, keyof Toggles>> = { snap: "snap" }

/** Whether the button shows pressed: its tool is armed, or its setting is on. */
export function buttonPressed(command: CommandId, active: CommandId | null, toggles: Toggles): boolean {
  const toggle = TOGGLE_OF_COMMAND[command]
  return toggle ? toggles[toggle] : active === command
}

/** Whether the button has a pressed state at all: a tool or a switch. */
export function hasPressedState(command: CommandId): boolean {
  return isToolCommand(command) || command in TOGGLE_OF_COMMAND
}

/** The command of the armed schematic tool: wiring, or the Place tool in hand; null when none is armed. */
export function armedCommand(wiring: boolean, label: "label" | "gnd" | "vcc" | null): CommandId | null {
  if (wiring) return "wire"
  if (label === "label") return "netLabel"
  if (label === "gnd") return "groundFlag"
  if (label === "vcc") return "powerFlag"
  return null
}

/** The command of the armed drawing tool, or null when none is armed. */
export function drawToolCommand(tool: DrawTool | null): CommandId | null {
  return tool ? DRAW_TOOL_COMMAND[tool] : null
}
