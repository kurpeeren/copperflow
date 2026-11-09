// The right-click menu as data: its items for each target (a part, a net label, a wire or a drawing on the schematic, a
// track or via on the PCB, the empty canvas),
// where it opens so it stays inside the window, and what a right click does to the selection. Items that have a
// command run it through the same path as the menu bar; the few that need the canvas or the target are "special".
import type { ContextTarget } from "../pcb/press.js"
import type { Point } from "../pcb/geometry.js"
import type { Selection } from "../selection.js"
import type { MenuShape } from "./menu-keys.js"
import { ALIGN_COMMANDS, alignDisabledReason, type AlignCommand } from "../pcb/align-rules.js"
import type { WireReasons } from "../pcb/wire-actions.js"
import { ENGINE, type CommandId } from "./menus.js"

/** What an item does besides running a command: open Properties, rename a label's net, highlight a label's net. */
export type ContextSpecial = "properties" | "rename" | "highlightNet"

export interface ContextItem {
  label: string
  shortcut?: string
  command?: CommandId
  special?: ContextSpecial
  /** Why the item cannot run yet. */
  pending?: string
}

export type ContextEntry = ContextItem | "separator"

/** What the items depend on besides the target. */
export interface ContextState {
  /** Every selected part is locked, so the item offers Unlock. */
  allLocked: boolean
  /** How many parts are selected; two or more add the align and distribute items. */
  selected: number
  /** On a wire: why Delete and Remove corners cannot run (wire-actions.ts), shown as their disabled reason. */
  wire?: WireReasons
  /** On copper: every selected track and via is locked, so the item offers Unlock. */
  copperLocked?: boolean
}

const run = (label: string, command: CommandId, shortcut?: string): ContextItem => (shortcut ? { label, command, shortcut } : { label, command })

const ALIGN_LABELS: Record<AlignCommand, string> = {
  alignLeft: "Align left",
  alignRight: "Align right",
  alignTop: "Align top",
  alignBottom: "Align bottom",
  alignHCentres: "Align horizontal centres",
  alignVCentres: "Align vertical centres",
  distributeH: "Distribute horizontally",
  distributeV: "Distribute vertically",
}
const ALIGN_KEYS: Partial<Record<AlignCommand, string>> = { alignLeft: "Ctrl+Shift+L", distributeH: "Ctrl+Shift+H" }

/** The align and distribute items of a multi-selection; one that needs more parts than are selected is disabled, with the reason. */
function alignItems(selected: number): ContextEntry[] {
  if (selected < 2) return []
  const item = (command: AlignCommand): ContextItem => {
    const reason = alignDisabledReason(command, selected)
    const shortcut = ALIGN_KEYS[command]
    return { label: ALIGN_LABELS[command], command, ...(shortcut ? { shortcut } : {}), ...(reason ? { pending: reason } : {}) }
  }
  return ["separator", ...ALIGN_COMMANDS.slice(0, 6).map(item), "separator", ...ALIGN_COMMANDS.slice(6).map(item)]
}

function partItems({ allLocked, selected }: ContextState): ContextEntry[] {
  return [
    { label: "Properties", special: "properties" },
    "separator",
    run("Rotate", "rotate", "Space"),
    allLocked ? run("Unlock", "unlock") : run("Lock", "lock"),
    run("Highlight its nets", "highlight", "H"),
    ...alignItems(selected),
    "separator",
    run("Delete", "delete", "Delete"),
  ]
}

const CANVAS_ITEMS: readonly ContextEntry[] = [
  run("Fit all", "fit", "K"),
  run("Grid style", "gridStyle"),
  "separator",
  run("Zoom in", "zoomIn"),
  run("Zoom out", "zoomOut"),
  "separator",
  { label: "Paste", shortcut: "Ctrl+V", pending: ENGINE },
]

/** On a wire selected with other things: Delete acts on all of them (naming what stays), Remove corners on a wire alone. */
export const WIRE_IN_GROUP: WireReasons = { remove: null, removeCorners: "Select this wire alone to remove its corners" }

/** A command item, disabled with `reason` when there is one. */
const runUnless = (item: ContextItem, reason: string | null | undefined): ContextItem => (reason ? { ...item, pending: reason } : item)

function wireItems(reasons: WireReasons | undefined): ContextEntry[] {
  return [
    { label: "Properties", special: "properties" },
    "separator",
    run("Highlight net", "highlight", "H"),
    runUnless(run("Remove corners", "removeCorners"), reasons?.removeCorners),
    "separator",
    runUnless(run("Delete", "delete", "Delete"), reasons?.remove),
  ]
}

const DRAWING_ITEMS: readonly ContextEntry[] = [{ label: "Properties", special: "properties" }, "separator", run("Delete", "delete", "Delete")]

const LABEL_ITEMS: readonly ContextEntry[] = [
  { label: "Rename", special: "rename" },
  { label: "Highlight net", special: "highlightNet" },
]

/** On a track or via: Properties, Lock or Unlock (the selected copper), Delete. */
function copperItems(locked: boolean | undefined): ContextEntry[] {
  return [{ label: "Properties", special: "properties" }, "separator", locked ? run("Unlock", "unlock") : run("Lock", "lock"), "separator", run("Delete", "delete", "Delete")]
}

/** The items for a right click on `target`. */
export function contextItems(target: ContextTarget, state: ContextState): ContextEntry[] {
  if (target.kind === "part") return partItems(state)
  if (target.kind === "copper") return copperItems(state.copperLocked)
  if (target.kind === "wire") return wireItems(state.wire)
  if (target.kind === "drawing") return [...DRAWING_ITEMS]
  return [...(target.kind === "label" ? LABEL_ITEMS : CANVAS_ITEMS)]
}

/** The slots the menu keys step through (menu-keys.ts): pending items take the focus but do nothing. */
export function contextShape(entries: readonly ContextEntry[]): MenuShape {
  return entries.map((entry) => (entry === "separator" ? "separator" : entry.pending ? "disabled" : "item"))
}

/** Whether every selected part is locked (and some part is selected), so the menu offers Unlock. */
export function allLocked(names: readonly string[], locked: ReadonlySet<string>): boolean {
  return names.length > 0 && names.every((name) => locked.has(name))
}

/** A right click on a part, a wire, a label or a drawing that is not selected selects it alone; on a selected one the group stays. */
export function contextSelection(selection: Selection, target: ContextTarget): Selection {
  if (target.kind === "drawing") return selection.hasDrawing(target.id) ? selection : selection.onlyDrawing(target.id)
  if (target.kind === "wire") return selection.hasWire(target.id) ? selection : selection.onlyWire(target.id)
  if (target.kind === "label") return selection.hasLabel(target.label.id) ? selection : selection.onlyLabel(target.label.id)
  if (target.kind === "copper") return selection.hasCopper(target.id) ? selection : selection.onlyCopper(target.id)
  return target.kind === "part" && !selection.has(target.name) ? selection.only(target.name) : selection
}

export interface Size {
  width: number
  height: number
}

const ITEM_HEIGHT = 28
const SEPARATOR_HEIGHT = 9
/** The dropdown's padding (4px) top and bottom plus its 1px borders. */
const BOX_EXTRA = 10
export const MENU_WIDTH = 240

/** The menu's size, from its items (the dropdown CSS has 28px items, 9px separators and a 240px minimum width). */
export function contextSize(entries: readonly ContextEntry[]): Size {
  const rows = entries.reduce((sum, entry) => sum + (entry === "separator" ? SEPARATOR_HEIGHT : ITEM_HEIGHT), 0)
  return { width: MENU_WIDTH, height: rows + BOX_EXTRA }
}

/** Where the menu's top-left corner goes: at the pointer, flipped to the left and up when it would leave the window. */
export function placeMenu(at: Point, menu: Size, room: Size): Point {
  const flip = (pointer: number, length: number, space: number) => Math.max(0, pointer + length > space ? pointer - length : pointer)
  return { x: flip(at.x, menu.width, room.width), y: flip(at.y, menu.height, room.height) }
}
