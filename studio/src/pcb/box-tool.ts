// The two one-shot box tools, Place → Note box and View → Fit area: one is armed at a time, the next left drag draws
// its box (gestures.ts), and then it is put away. Esc or a right click puts it away too. Plain data, so a test can
// follow it.
import type { CommandId } from "../shell/menus.js"

export type BoxTool = "note" | "zoom"

/** The hint shown while the tool is armed. */
export const NOTE_HINT = "Drag a box where the note for the agent goes. Esc or a right click stops."
export const FIT_AREA_HINT = "Drag a box to zoom to it. Esc or a right click stops."

/** Arming a tool puts the other away: the one armed last is the one that is. */
export const armBoxTool = (tool: BoxTool): BoxTool => tool

export const boxToolHint = (tool: BoxTool | null): string | undefined => (tool === "note" ? NOTE_HINT : tool === "zoom" ? FIT_AREA_HINT : undefined)

/** The toolbar command that shows pressed while the tool is armed; Note box has no toolbar button. */
export const boxToolCommand = (tool: BoxTool | null): CommandId | null => (tool === "zoom" ? "fitArea" : null)
