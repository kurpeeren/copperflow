// What a pointer press on a canvas starts, from its button, its modifiers and whether it is on a part.
import { togglesSelection } from "../selection.js"

/** What a pointer press says: its button and the modifiers that change what it does. */
export interface Press {
  button: number
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

/**
 * "pan" for the middle or right button; "toggle" for Shift or Ctrl on a part, which toggles it in or out of the
 * selection and starts nothing; "note" for Shift elsewhere, which draws a note box; "part" for a press on a part,
 * which selects it alone and drags it; "empty" for the rest (a net label, or a pan).
 */
export type PressKind = "pan" | "toggle" | "note" | "part" | "empty"

export function pressKind(press: Press, onPart: boolean): PressKind {
  if (press.button === 1 || press.button === 2) return "pan"
  if (onPart && togglesSelection(press)) return "toggle"
  if (press.shiftKey) return "note"
  return onPart ? "part" : "empty"
}
