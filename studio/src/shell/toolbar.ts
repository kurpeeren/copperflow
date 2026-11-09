// The toolbar as data: the buttons of each view, in order, in groups. Each button sends the command the menu item of
// the same name sends; a title names the key in brackets, as the menu shows it. A test holds the two together.
import type { View } from "../pcb/positions.js"
import type { CommandId } from "./menus.js"

export type ToolIconName = "undo" | "zoomIn" | "zoomOut" | "fit" | "component" | "wire" | "netLabel" | "ground" | "power" | "rotate" | "check"

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

const UNDO = button("undo", "Undo (Ctrl+Z)", "undo", "undo", 0)
const ZOOM = [button("zoomIn", "Zoom in", "zoomIn", "zoomIn", 1), button("zoomOut", "Zoom out", "zoomOut", "zoomOut", 1), button("fit", "Fit all (K)", "fit", "fit", 1)]
const ROTATE = (group: number) => button("rotate", "Rotate (Space)", "rotate", "rotate", group)
const CHECK = (group: number) => button("checkDrc", "Check DRC", "check", "checkDrc", group)

export const TOOLBARS: Readonly<Record<View, readonly ToolbarButton[]>> = {
  schematic: [
    UNDO,
    ...ZOOM,
    button("component", "Component (Shift+F)", "component", "placeComponent", 2),
    button("wire", "Wire (Alt+W)", "wire", "wire", 2),
    button("netLabel", "Net label (Alt+N)", "netLabel", "netLabel", 2),
    button("ground", "Ground flag", "ground", "groundFlag", 2),
    button("power", "Power flag", "power", "powerFlag", 2),
    ROTATE(3),
    CHECK(4),
  ],
  pcb: [UNDO, ...ZOOM, { id: "unit", title: "Unit (Q)", text: "unit", command: "toggleUnit", group: 2 }, ROTATE(3), CHECK(4)],
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
const TOOL_COMMANDS: ReadonlySet<CommandId> = new Set(["wire", "netLabel", "groundFlag", "powerFlag"])

export function isToolCommand(command: CommandId): boolean {
  return TOOL_COMMANDS.has(command)
}

/** The command of the armed schematic tool: wiring, or the Place tool in hand; null when none is armed. */
export function armedCommand(wiring: boolean, label: "label" | "gnd" | "vcc" | null): CommandId | null {
  if (wiring) return "wire"
  if (label === "label") return "netLabel"
  if (label === "gnd") return "groundFlag"
  if (label === "vcc") return "powerFlag"
  return null
}
