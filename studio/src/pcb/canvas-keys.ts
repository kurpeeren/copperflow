// The keys the canvases and the app share, as a pure map from a key press to an action. The hooks that
// listen for keys read the browser event once (keyInput) and ask this module what it means.
// Our own keys stay as they are; the EasyEDA ones sit beside them.
import type { View } from "./positions.js"

export type KeyActionName =
  | "wire"
  | "armNetLabel"
  | "rotate"
  | "fit"
  | "highlight"
  | "clearHighlight"
  | "toggleUnit"
  | "toggleGridStyle"
  | "toggleSnap"
  | "toggleLeftPanel"
  | "toggleRightPanel"
  | "toggleBottomPanel"
  | "openLibrary"
  | "undo"
  | "redo"
  | "openFile"
  | "selectAll"
  | "find"
  | "nudgeLeft"
  | "nudgeRight"
  | "nudgeUp"
  | "nudgeDown"
  | "contextMenu"
  | "delete"
  | "removeCorner"
  | "flipBend"
  | "alignLeft"
  | "distributeH"

/** What a key event says, apart from the browser: modifiers, whether it came from a field, and the key. */
export interface KeyInput {
  key: string
  /** The physical key, e.g. `KeyW`; Alt changes the character on some layouts, so Alt combinations use this. */
  code?: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  /** AltGr is held (the browser's AltGraph modifier); Windows also reports it as Ctrl+Alt. */
  altGraph?: boolean
  /** Focus is in a text field, where every key is the field's. */
  typing: boolean
  /** Focus is on a button or a checkbox, which Space presses. */
  onButton?: boolean
  /** Focus is in a widget that handles its own keys (a table row, listbox, tree, tab, menu); shortcuts still work there. */
  ownsKeys?: boolean
  /** That widget's rows are placed parts (the Component tree, `data-keys="parts"`): Delete and Backspace still remove the selection. */
  partRows?: boolean
  /** A widget already handled the event (defaultPrevented); this counts only for its navigation and activation keys. */
  handled?: boolean
}

export interface KeyState {
  view: View
  /** The wire tool is drawing a wire, which owns the keys. */
  drawing?: boolean
}

export interface KeyResult {
  action: KeyActionName
  preventDefault: boolean
  /** For the arrow keys: how many grid steps the key moves (1, or 10 with Shift). */
  steps?: number
}

const act = (action: KeyActionName, preventDefault = false): KeyResult => ({ action, preventDefault })

/** Grid steps an arrow key moves, and with Shift. */
export const NUDGE_STEPS = 1
export const NUDGE_STEPS_SHIFT = 10

/** The arrow keys and the direction they push in the world, where y points up. */
const ARROWS: ReadonlyMap<string, { action: KeyActionName; dx: number; dy: number }> = new Map([
  ["ArrowLeft", { action: "nudgeLeft", dx: -1, dy: 0 }],
  ["ArrowRight", { action: "nudgeRight", dx: 1, dy: 0 }],
  ["ArrowUp", { action: "nudgeUp", dx: 0, dy: 1 }],
  ["ArrowDown", { action: "nudgeDown", dx: 0, dy: -1 }],
])

/** The world direction of a nudge action, as a unit step; undefined for any other action. */
export function nudgeDirection(action: KeyActionName): { dx: number; dy: number } | undefined {
  for (const arrow of ARROWS.values()) if (arrow.action === action) return { dx: arrow.dx, dy: arrow.dy }
  return undefined
}

/** An arrow key, bare or with Shift; a focused button or tab keeps its own arrows. */
function arrowAction(input: KeyInput): KeyResult | null {
  const arrow = ARROWS.get(input.key)
  if (!arrow || input.onButton || input.ctrlKey || input.metaKey || input.altKey) return null
  return { action: arrow.action, preventDefault: true, steps: input.shiftKey ? NUDGE_STEPS_SHIFT : NUDGE_STEPS }
}

/** Widgets that handle their own keys: their arrows, Enter, Space, Delete and letters never reach the canvas. */
const OWN_KEYS = "tr, [role='row'], [role='gridcell'], [role='grid'], [role='listbox'], [role='option'], [role='tree'], [role='treeitem'], [role='tablist'], [role='tab'], [role='radiogroup'], [role='menu'], [role='menubar'], [role='menuitem'], [role='menuitemcheckbox'], [data-keys='own']"

/** Fields that take every key: text inputs, text areas, selects and editable text. A checkbox is pressed like a button. */
const FIELDS = "input:not([type='checkbox']):not([type='radio']), textarea, select, [contenteditable='true']"
const PRESSABLE = "button, a[href], summary, input[type='checkbox'], input[type='radio']"
/** A list whose rows are placed parts, as EasyEDA's tree: Delete there removes the selected parts. */
const PART_ROWS = "[data-keys='parts']"

/** A key event as plain data. */
export function keyInput(event: KeyboardEvent): KeyInput {
  const target = event.target instanceof HTMLElement ? event.target : null
  return {
    key: event.key,
    code: event.code,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altGraph: event.getModifierState?.("AltGraph") ?? false,
    typing: target?.closest(FIELDS) != null,
    onButton: target?.closest(PRESSABLE) != null,
    ownsKeys: target?.closest(OWN_KEYS) != null,
    partRows: target?.closest(PART_ROWS) != null,
    handled: event.defaultPrevented,
  }
}

/** The letter of an Alt combination, from the physical key when there is one. */
const altLetter = (input: KeyInput): string => (input.code?.startsWith("Key") ? input.code.slice(3).toLowerCase() : input.key.toLowerCase())

function altAction(input: KeyInput, state: KeyState): KeyResult | null {
  if (input.shiftKey) return null
  const letter = altLetter(input)
  if (letter === "s") return act("toggleSnap", true)
  if (state.view !== "schematic") return null
  if (letter === "w") return act("wire", true)
  return letter === "n" ? act("armNetLabel", true) : null
}

/** F fits and Shift+F opens the library; Caps Lock gives a capital F without Shift, which still fits. */
function letterAction(letter: string, input: KeyInput, state: KeyState): KeyResult | null {
  switch (letter) {
    case "w":
      return state.view === "schematic" ? act("wire") : null
    case "r":
      return act("rotate")
    case "k":
      return act("fit")
    case "f":
      // Prevented, so the F is not typed into the search field that this focuses.
      return input.shiftKey ? act("openLibrary", true) : act("fit")
    case "h":
      return input.shiftKey ? act("clearHighlight") : act("highlight")
    case "q":
      return state.view === "pcb" ? act("toggleUnit") : null
    default:
      return null
  }
}

/** Keys bound by the character they produce; on many layouts (Turkish Q, German) that character needs AltGr. */
const PANEL_KEYS: ReadonlyMap<string, KeyActionName> = new Map([
  ["[", "toggleLeftPanel"],
  ["]", "toggleRightPanel"],
  ["\\", "toggleBottomPanel"],
])

/** No modifier, or only AltGr, which Windows sends as Ctrl+Alt; Ctrl alone stays a browser shortcut. */
const plainOrAltGr = (input: KeyInput): boolean =>
  !input.metaKey && (input.altGraph === true || (input.ctrlKey && input.altKey) || (!input.ctrlKey && !input.altKey))

/** Ctrl (or Cmd) with these letters, by the character the key produces; prevented, so the browser's own does not run too. */
const CTRL_KEYS: ReadonlyMap<string, KeyActionName> = new Map([
  ["z", "undo"],
  ["y", "redo"],
  ["o", "openFile"],
  ["a", "selectAll"],
  ["f", "find"],
])

/** Ctrl (or Cmd) and Shift with these letters, by the character: Ctrl+Shift+Z redoes, as Ctrl+Y does. */
const CTRL_SHIFT_KEYS: ReadonlyMap<string, KeyActionName> = new Map([
  ["z", "redo"],
  ["l", "alignLeft"],
  ["h", "distributeH"],
])

/** Ctrl (or Cmd) with Z, Y, O, A or F, or with Shift and Z (redo), L (align left) or H (distribute horizontally); AltGr combinations are not ours. */
function ctrlAction(input: KeyInput): KeyResult | null {
  if (input.altKey || input.altGraph) return null
  const action = (input.shiftKey ? CTRL_SHIFT_KEYS : CTRL_KEYS).get(input.key.toLowerCase())
  return action ? act(action, true) : null
}

/** Delete or Backspace removes the selected parts; while a wire is drawn, Backspace takes back its last corner instead. */
function removeAction(input: KeyInput, state: KeyState): KeyResult | null {
  if (!state.drawing) return act("delete")
  // Taking back a corner is the canvas's alone, not a focused row's.
  return input.key === "Backspace" && !input.ownsKeys ? act("removeCorner", true) : null
}

const removes = (input: KeyInput): boolean => input.key === "Delete" || input.key === "Backspace"

/** A focused widget keeps its navigation and activation keys, except Delete and Backspace on rows that are placed parts. */
const widgetKeeps = (input: KeyInput): boolean => input.ownsKeys === true && !(input.partRows === true && removes(input))

/** Shift+F10 or the menu key opens the context menu, as a right click does; prevented, so the browser's own does not open. */
const opensMenu = (input: KeyInput): boolean =>
  input.key === "ContextMenu" || (input.key === "F10" && input.shiftKey && !input.ctrlKey && !input.altKey && !input.metaKey)

/** What the key press means in this view, or null when it is not ours (or belongs to a field or a browser shortcut). */
export function keyAction(input: KeyInput, state: KeyState): KeyResult | null {
  if (input.typing) return null
  if (opensMenu(input)) return act("contextMenu", true)
  const panel = PANEL_KEYS.get(input.key)
  if (panel && plainOrAltGr(input)) return act(panel)
  if (input.ctrlKey || input.metaKey) return ctrlAction(input)
  if (input.altKey) return altAction(input, state)
  // The navigation and activation keys (arrows, Space, Delete, Backspace, the letters) belong to a focused table row,
  // list, tree, tab or menu, and one that a widget already took is not the canvas's too; the shortcuts above still
  // work there.
  if (input.handled || widgetKeeps(input)) return null
  const arrow = arrowAction(input)
  if (arrow) return arrow
  if (removes(input)) return removeAction(input, state)
  // Space presses a focused button; otherwise it flips the wire being drawn, or rotates.
  if (input.key === " ") return input.onButton ? null : act(state.drawing ? "flipBend" : "rotate", true)
  return letterAction(input.key.toLowerCase(), input, state)
}

/** Esc puts a Place tool away, unless focus is in a text field (the name input and the Inspector fields handle their own Esc). */
export function escapeDisarms(input: KeyInput): boolean {
  return input.key === "Escape" && !input.typing
}
