// Who answers each command the menu bar and the toolbar send: the app itself, the workspace (panels, unit,
// highlight) as its keys do, or the open canvas over the command bus. Each handler table is typed by its list here,
// so a test can check that every command shown has someone to run it.
import type { KeyActionName } from "../pcb/canvas-keys.js"
import type { CommandId } from "./menus.js"

/** Run by use-app-commands.ts. */
export const APP_COMMANDS = ["openFile", "exportBom", "exportPackage", "undo", "selectAll", "find", "checkDrc", "lock", "unlock", "history", "keys", "about"] as const satisfies readonly CommandId[]
export type AppCommand = (typeof APP_COMMANDS)[number]

/** Run by the workspace, as the key with the same action is. */
export const WORKSPACE_COMMANDS = {
  toggleUnit: "toggleUnit",
  gridStyle: "toggleGridStyle",
  toggleLeftPanel: "toggleLeftPanel",
  toggleRightPanel: "toggleRightPanel",
  toggleBottomPanel: "toggleBottomPanel",
  clearHighlight: "clearHighlight",
  placeComponent: "openLibrary",
} as const satisfies Partial<Record<CommandId, KeyActionName>>

/** Answered by either canvas: its camera (canvas-common.ts). */
export const CAMERA_COMMANDS = ["zoomIn", "zoomOut"] as const satisfies readonly CommandId[]
export type CameraCommand = (typeof CAMERA_COMMANDS)[number]

/** Answered by either canvas: the selection, its parts and their nets (use-part-keys.ts). */
export const PART_COMMANDS = ["fit", "rotate", "delete", "highlight"] as const satisfies readonly CommandId[]
export type PartCommand = (typeof PART_COMMANDS)[number]

/** Answered by either canvas: the tools both views have, such as Place → Note box (use-note-tool.ts). */
export const CANVAS_TOOL_COMMANDS = ["noteBox"] as const satisfies readonly CommandId[]
export type CanvasToolCommand = (typeof CANVAS_TOOL_COMMANDS)[number]

/** Answered by the schematic only (SchematicCanvas.tsx); sent while the PCB is open, they switch to the schematic first. */
export const SHEET_COMMANDS = ["wire", "netLabel", "groundFlag", "powerFlag"] as const satisfies readonly CommandId[]
export type SheetCommand = (typeof SHEET_COMMANDS)[number]

export type CommandOwner = "app" | "workspace" | "canvas" | "schematic"

const has = (list: readonly CommandId[], command: CommandId) => list.includes(command)

/** Who runs `command`, or undefined when nobody does. */
export function commandOwner(command: CommandId): CommandOwner | undefined {
  if (has(APP_COMMANDS, command)) return "app"
  if (command in WORKSPACE_COMMANDS) return "workspace"
  if (has(CAMERA_COMMANDS, command) || has(PART_COMMANDS, command) || has(CANVAS_TOOL_COMMANDS, command)) return "canvas"
  return has(SHEET_COMMANDS, command) ? "schematic" : undefined
}
