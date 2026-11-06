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
  | "toggleLeftPanel"
  | "toggleRightPanel"
  | "toggleBottomPanel"
  | "openLibrary"

/** What a key event says, apart from the browser: modifiers, whether it came from a field, and the key. */
export interface KeyInput {
  key: string
  /** The physical key, e.g. `KeyW`; Alt changes the character on some layouts, so Alt combinations use this. */
  code?: string
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  /** Focus is in a text field, where every key is the field's. */
  typing: boolean
  /** Focus is on a button, which Space presses. */
  onButton?: boolean
}

export interface KeyState {
  view: View
  /** The wire tool is drawing a wire, which owns the keys. */
  drawing?: boolean
}

export interface KeyResult {
  action: KeyActionName
  preventDefault: boolean
}

const act = (action: KeyActionName, preventDefault = false): KeyResult => ({ action, preventDefault })

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
    typing: target?.closest("input, textarea, select, [contenteditable='true']") != null,
    onButton: target?.closest("button, a[href], summary") != null,
  }
}

/** The letter of an Alt combination, from the physical key when there is one. */
const altLetter = (input: KeyInput): string => (input.code?.startsWith("Key") ? input.code.slice(3).toLowerCase() : input.key.toLowerCase())

function altAction(input: KeyInput, state: KeyState): KeyResult | null {
  if (input.shiftKey || state.view !== "schematic") return null
  const letter = altLetter(input)
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

/** What the key press means in this view, or null when it is not ours (or belongs to a field or a browser shortcut). */
export function keyAction(input: KeyInput, state: KeyState): KeyResult | null {
  if (input.typing || input.ctrlKey || input.metaKey) return null
  if (input.altKey) return altAction(input, state)
  if (input.key === " ") return state.drawing || input.onButton ? null : act("rotate", true)
  if (input.key === "[") return act("toggleLeftPanel")
  if (input.key === "]") return act("toggleRightPanel")
  if (input.key === "\\") return act("toggleBottomPanel")
  return letterAction(input.key.toLowerCase(), input, state)
}

/** Esc puts a Place tool away, unless focus is in a text field (the name input and the Inspector fields handle their own Esc). */
export function escapeDisarms(input: KeyInput): boolean {
  return input.key === "Escape" && !input.typing
}
