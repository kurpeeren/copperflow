// What the Checks panel decides: when it opens by itself, what clicking a row changes and when a click gives up focus.
// Only types come from the engine: its runtime modules reach Node-only code the Studio bundle cannot hold.
import type { Point } from "../../src/engine/model.js"
import type { CheckRow } from "./checks-list.js"
import type { View } from "./pcb/positions.js"

/** Asks the canvas of `view` to centre its camera on `at`, at the current zoom. */
export interface FocusRequest {
  view: View
  at: Point
}

/** What clicking a row changes: the view to show, where to centre it, and the part to select. */
export interface CheckPick {
  tab?: View
  focus?: FocusRequest
  select?: string
}

/**
 * True when a finished build has errors and the finished build before it had none. The first build
 * has no build before it, so it never opens the panel; a panel closed by hand stays closed while the
 * errors go on.
 */
export function opensOnBuild(previousErrors: number | undefined, errors: number): boolean {
  return previousErrors === 0 && errors > 0
}

/** A canvas row shows its view and centres on its position, when it has one; any row selects the part it names. */
export function checkPick(row: CheckRow): CheckPick {
  const view = row.view === "code" ? undefined : row.view
  return {
    ...(view ? { tab: view } : {}),
    ...(view && row.at ? { focus: { view, at: row.at } } : {}),
    ...(row.part ? { select: row.part } : {}),
  }
}

/**
 * True for a pointer click (`detail` counts the presses), which gives up focus so Space rotates
 * the part instead of pressing the row again. Enter or Space on a focused row clicks with detail 0
 * and keeps focus there, so the list can be walked from the keyboard.
 */
export function blursAfterClick(event: { detail: number }): boolean {
  return event.detail > 0
}
