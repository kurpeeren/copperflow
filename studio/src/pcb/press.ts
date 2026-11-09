// What a pointer press on a canvas starts, from its button, its modifiers, what is under the pointer and the armed
// tool, and what a release that did not move then does. EasyEDA's mouse: a left drag on empty canvas draws a
// selection box, a left drag on a selected part moves the whole selection, and the right button pans or, released
// without moving, opens the context menu.
import type { NetLabel } from "../../../src/engine/schematic.js"
import { togglesSelection } from "../selection.js"

/** What a pointer press says: its button and the modifiers that change what it does. */
export interface Press {
  button: number
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

/** What is under the pointer at a press: a part, one already selected, a net label (schematic) or nothing. */
export type Under = "part" | "selectedPart" | "label" | "empty"

/** The canvas tool that takes a left press while it is armed: Place → Note box. */
export type ArmedTool = "note" | null

/**
 * - "pan": the middle button pans.
 * - "rightPress": the right button pans once it moves; released without moving, it opens the context menu.
 * - "note": with the Note box tool armed, a left drag draws the note box.
 * - "toggle": Shift or Ctrl on a part toggles it in or out of the selection and starts nothing.
 * - "move": on a part not selected: selects it alone and drags it.
 * - "moveGroup": on a selected part: drags the whole selection; released without moving, selects that part alone.
 * - "label": on a net label: drags it.
 * - "box": on empty canvas: a selection box that replaces the selection; released without moving, clears it.
 * - "addBox": Shift or Ctrl anywhere but on a part: a selection box that adds to the selection.
 * - "none": any other button.
 */
export type GestureStart = "pan" | "rightPress" | "note" | "toggle" | "move" | "moveGroup" | "label" | "box" | "addBox" | "none"

const LEFT = 0
const MIDDLE = 1
const RIGHT = 2

export function gestureStart(press: Press, under: Under, armed: ArmedTool): GestureStart {
  if (press.button === MIDDLE) return "pan"
  if (press.button === RIGHT) return "rightPress"
  if (press.button !== LEFT) return "none"
  if (armed === "note") return "note"
  const onPart = under === "part" || under === "selectedPart"
  if (togglesSelection(press)) return onPart ? "toggle" : "addBox"
  if (under === "part") return "move"
  if (under === "selectedPart") return "moveGroup"
  return under === "label" ? "label" : "box"
}

/** What a release does when the pointer has not moved: select the pressed part alone, clear, open the menu, put the tool away, or nothing. */
export type StillRelease = "selectAlone" | "clear" | "menu" | "disarm" | "none"

export function stillRelease(start: GestureStart, armed: ArmedTool): StillRelease {
  if (start === "rightPress") return armed ? "disarm" : "menu"
  if (start === "moveGroup") return "selectAlone"
  return start === "box" ? "clear" : "none"
}

/** A pointer that went this far from its press, in CSS pixels, has moved; less is a click. */
export const DRAG_THRESHOLD_PX = 3

export function hasMoved(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= DRAG_THRESHOLD_PX
}

/** What a right click (or a double click) is on: a part, a net label in the schematic, or the empty canvas. */
export type ContextTarget = { kind: "part"; name: string } | { kind: "label"; label: NetLabel } | { kind: "canvas" }
