// What a pointer press on a canvas starts, from its button, its modifiers, what is under the pointer and the armed
// tool, and what a release that did not move then does. EasyEDA's mouse: a left drag on empty canvas draws a
// selection box, a left drag on a selected part or wire moves the whole selection, and the right button pans or,
// released without moving, opens the context menu.
import type { NetLabel } from "../../../src/engine/schematic.js"
import { togglesSelection } from "../selection.js"

/** What a pointer press says: its button and the modifiers that change what it does. */
export interface Press {
  button: number
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

/**
 * What is under the pointer at a press: a part, one already selected, a net label, a label selected with other things,
 * a wire, a wire selected with other things (parts, labels or other wires), a corner handle of the wire selected alone
 * (schematic), a drawing, one already selected, or nothing.
 */
export type Under = "part" | "selectedPart" | "label" | "selectedLabel" | "wire" | "selectedWire" | "wireCorner" | "drawing" | "selectedDrawing" | "text" | "empty"

/**
 * The armed canvas tool, as far as a press is concerned: Place → Note box and View → Fit area take every left press; a schematic Place
 * tool (net label, ground or power flag) leaves an empty left drag to pan, as before the selection box.
 */
export type ArmedTool = "note" | "zoom" | "place" | null

/**
 * - "pan": the middle button pans.
 * - "rightPress": the right button pans once it moves; released without moving, it opens the context menu.
 * - "note": with the Note box tool armed, a left drag draws the note box.
 * - "zoom": with the Fit area tool armed, a left drag draws the box the camera fits.
 *   With a Place tool armed, a left press on empty canvas is a "pan" (its click is the tool's, on a pin).
 * - "toggle": Shift or Ctrl on a part, a net label, a drawing or a wire toggles it in or out of the selection and starts nothing.
 * - "move": on a part or drawing not selected: selects it alone and drags it.
 * - "moveGroup": on a selected part or drawing, or a wire or label selected with other things: drags the whole
 *   selection; released without moving, selects that part, drawing, wire or label alone.
 * - "label": on a net label not selected, or selected alone: selects it alone and drags it.
 * - "text": on a part's name, value or designator: selects it alone and drags it (it never moves with a selection).
 * - "wireSegment": on a schematic wire not selected, or selected alone: selects it alone (the parts go) and drags the
 *   segment under the press.
 * - "wireCorner": on a corner handle of the wire selected alone: drags that corner.
 * - "wire": on a wire or its corner handle with a Place tool armed: selects the wire and starts nothing.
 * - "box": on empty canvas: a selection box that replaces the selection; released without moving, clears it.
 * - "addBox": Shift or Ctrl anywhere but on a part, a label or a wire: a selection box that adds to the selection.
 * - "none": any other button.
 * A wire's drag reshapes it; released without moving, the press has only selected it.
 */
export type GestureStart =
  | "pan"
  | "rightPress"
  | "note"
  | "zoom"
  | "toggle"
  | "move"
  | "moveGroup"
  | "label"
  | "text"
  | "wireSegment"
  | "wireCorner"
  | "wire"
  | "box"
  | "addBox"
  | "none"

/** What Shift or Ctrl toggles in or out of the selection: a part, a net label, a drawing or a wire, also through its corner handle. */
const TOGGLES: ReadonlySet<Under> = new Set(["part", "selectedPart", "label", "selectedLabel", "wire", "selectedWire", "wireCorner", "drawing", "selectedDrawing", "text"])

/** What a plain press drags with the whole selection: a selected part or drawing, or a wire or label selected with other things. */
const GROUP: ReadonlySet<Under> = new Set(["selectedPart", "selectedWire", "selectedLabel", "selectedDrawing"])

const LEFT = 0
const MIDDLE = 1
const RIGHT = 2

/** What a plain left press on a wire or on the selected wire's corner handle starts while no tool is armed. */
const WIRE_PRESS: Record<"wire" | "wireCorner", GestureStart> = { wire: "wireSegment", wireCorner: "wireCorner" }

export function gestureStart(press: Press, under: Under, armed: ArmedTool): GestureStart {
  if (press.button === MIDDLE) return "pan"
  if (press.button === RIGHT) return "rightPress"
  if (press.button !== LEFT) return "none"
  if (armed === "note") return "note"
  if (armed === "zoom") return "zoom"
  if (armed === "place" && under === "empty") return "pan"
  if (togglesSelection(press)) return TOGGLES.has(under) ? "toggle" : "addBox"
  if (under === "part" || under === "drawing") return "move"
  if (GROUP.has(under)) return "moveGroup"
  if (under === "wire" || under === "wireCorner") return armed === null ? WIRE_PRESS[under] : "wire"
  if (under === "text") return "text"
  return under === "label" ? "label" : "box"
}

/** The right button's bit in a pointer event's `buttons`. */
const RIGHT_BUTTON_BIT = 2

/**
 * Whether the right button is held, from a pointer event's `buttons`. A right press while the left button drags comes
 * as a pointer move with both bits set, not as a press; it cancels a wire's reshape.
 */
export function rightButtonHeld(buttons: number): boolean {
  return (buttons & RIGHT_BUTTON_BIT) !== 0
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

/** Fields and buttons inside a canvas keep their own double click: the label's name input, the unit button. */
const CONTROLS = "input, textarea, select, form, button"

/**
 * Whether a double click opens Properties (or renames a net): the left button, anywhere on the drawing. The handlers
 * sit on the canvas on the PCB and on the sheet's wrapper on the schematic, so the target is not always the canvas.
 */
export function opensOnDoubleClick(event: { button: number; target: unknown }): boolean {
  if (event.button !== LEFT) return false
  const target = event.target as { closest?: (selector: string) => unknown } | null
  return typeof target?.closest !== "function" || !target.closest(CONTROLS)
}

/**
 * What a right click (or a double click) is on: a part, a net label, a wire or a drawing (by its id) in the schematic, a
 * track or via on the PCB, a part's name, value or designator (by its text id), or the empty canvas.
 */
export type ContextTarget =
  | { kind: "part"; name: string }
  | { kind: "label"; label: NetLabel }
  | { kind: "wire"; id: string }
  | { kind: "drawing"; id: string }
  | { kind: "copper"; id: string }
  | { kind: "text"; id: string }
  | { kind: "canvas" }
