// Who answers each command the menu bar and the toolbar send: the app itself, the workspace (panels, unit,
// highlight) as its keys do, or the open canvas over the command bus. Each handler table is typed by its list here,
// so a test can check that every command shown has someone to run it.
import { ALIGN_COMMANDS } from "../pcb/align-rules.js"
import type { KeyActionName } from "../pcb/canvas-keys.js"
import { DRAW_COMMANDS } from "../pcb/draw-commands.js"
import type { CommandId } from "./menus.js"

/** Run by use-app-commands.ts. */
export const APP_COMMANDS = ["openFile", "exportBom", "exportPackage", "exportFabrication", "undo", "redo", "selectAll", "selectInstance", "replicateLayout", "makeSheet", "find", "checkDrc", "designRules", "autoplace", "autoplaceSelection", "autoplaceInstance", "fitBoard", "autoroute", "autorouteSelection", "autorouteNet", "unroute", "lock", "unlock", "history", "keys", "about", "addPage", "renamePage", "deletePage", "themeLight", "themeDark", "hoverLabels", "pourSolid", "pourHatched", "pourOutline", "findSimilar", "placementTransfer", "flip", "annotate", "systemSettings", "newCircuit", "copy", "paste"] as const satisfies readonly CommandId[]
export type AppCommand = (typeof APP_COMMANDS)[number]

/** Run by the workspace, as the key with the same action is. */
export const WORKSPACE_COMMANDS = {
  toggleUnit: "toggleUnit",
  gridStyle: "toggleGridStyle",
  snap: "toggleSnap",
  toggleLeftPanel: "toggleLeftPanel",
  toggleRightPanel: "toggleRightPanel",
  toggleBottomPanel: "toggleBottomPanel",
  clearHighlight: "clearHighlight",
  placeComponent: "openLibrary",
} as const satisfies Partial<Record<CommandId, KeyActionName>>

/** Answered by either canvas: its camera (canvas-common.ts). */
export const CAMERA_COMMANDS = ["zoomIn", "zoomOut"] as const satisfies readonly CommandId[]
export type CameraCommand = (typeof CAMERA_COMMANDS)[number]

/** Answered by either canvas: the camera fitted to the selection (use-fit-selection.ts). */
export const FIT_COMMANDS = ["fitSelection"] as const satisfies readonly CommandId[]
export type FitCommand = (typeof FIT_COMMANDS)[number]

/** Answered by either canvas: the selection, its parts and their nets (use-part-keys.ts). */
export const PART_COMMANDS = ["fit", "rotate", "rotateRight", "delete", "highlight", ...ALIGN_COMMANDS] as const satisfies readonly CommandId[]
export type PartCommand = (typeof PART_COMMANDS)[number]

/** Answered by either canvas: the tools both views have, such as Place → Note box (use-note-tool.ts). */
export const CANVAS_TOOL_COMMANDS = ["noteBox", "fitArea"] as const satisfies readonly CommandId[]
export type CanvasToolCommand = (typeof CANVAS_TOOL_COMMANDS)[number]

/** Answered by the schematic only (SchematicCanvas.tsx); sent while the PCB is open, they switch to the schematic first. */
export const SHEET_COMMANDS = ["wire", "netLabel", "groundFlag", "powerFlag", ...DRAW_COMMANDS] as const satisfies readonly CommandId[]
export type SheetCommand = (typeof SHEET_COMMANDS)[number]

/** Answered by the schematic only, which knows its parts and their locks: Layout → Tidy sheet (auto-placed.ts). */
export const SHEET_LAYOUT_COMMANDS = ["tidySheet"] as const satisfies readonly CommandId[]
export type SheetLayoutCommand = (typeof SHEET_LAYOUT_COMMANDS)[number]

/**
 * Answered by the schematic only (use-sheet-marks.ts): Place → No connect flag and Junction, the tools that put a
 * flag on a pin and a dot on a wire; sent while the PCB is open, they switch to the schematic first.
 */
export const MARK_COMMANDS = ["noConnect", "junction"] as const satisfies readonly CommandId[]
export type MarkCommand = (typeof MARK_COMMANDS)[number]

/**
 * Answered by the schematic only, for its selected wire (use-sheet-wires.ts): the context menu and Properties send
 * them. Delete and Highlight net are the part commands, which act on a selected wire too.
 */
export const WIRE_COMMANDS = ["removeCorners"] as const satisfies readonly CommandId[]
export type WireCommand = (typeof WIRE_COMMANDS)[number]

/** Answered by the PCB only (use-track-tool.ts); sent while the schematic is open, they switch to the PCB first. */
export const PCB_COMMANDS = ["singleRouting", "placeVia", "routingCorner"] as const satisfies readonly CommandId[]
export type PcbCommand = (typeof PCB_COMMANDS)[number]

/** Answered by the PCB only (use-pours.ts): Place → Copper pour, its whole-board form and Hole; sent while the schematic is open, they switch to the PCB first. */
export const POUR_COMMANDS = ["placePour", "placePourBoard", "placeHole"] as const satisfies readonly CommandId[]
export type PourCommand = (typeof POUR_COMMANDS)[number]

/** Answered by the PCB only, which holds the built copper (use-track-shape.ts): Edit → Fillet tracks and Straighten tracks. */
export const COPPER_COMMANDS = ["filletTracks", "straightenTracks"] as const satisfies readonly CommandId[]
export type CopperCommand = (typeof COPPER_COMMANDS)[number]

export type CommandOwner = "app" | "workspace" | "canvas" | "schematic" | "pcb"

const has = (list: readonly CommandId[], command: CommandId) => list.includes(command)

/** Who runs `command`, or undefined when nobody does. */
export function commandOwner(command: CommandId): CommandOwner | undefined {
  if (has(APP_COMMANDS, command)) return "app"
  if (command in WORKSPACE_COMMANDS) return "workspace"
  if (has(CAMERA_COMMANDS, command) || has(FIT_COMMANDS, command) || has(PART_COMMANDS, command) || has(CANVAS_TOOL_COMMANDS, command)) return "canvas"
  if (has(PCB_COMMANDS, command) || has(COPPER_COMMANDS, command) || has(POUR_COMMANDS, command)) return "pcb"
  return has(SHEET_COMMANDS, command) || has(SHEET_LAYOUT_COMMANDS, command) || has(WIRE_COMMANDS, command) || has(MARK_COMMANDS, command) ? "schematic" : undefined
}
