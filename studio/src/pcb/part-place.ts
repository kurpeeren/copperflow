// Click to place: a part picked in the Library is armed, and the next left click on the open canvas places it there,
// its position written (schX/schY on the sheet, pcbX/pcbY on the board, on the grid as a drag snaps). Plain data: the
// hint, the props a click writes and the toast after it. The armed part itself lives in shell/armed-part.ts.
import type { Literal } from "../../../src/core/types.js"
import { placeDefaults } from "../place-defaults.js"
import { snapPoint, type Point } from "./geometry.js"
import { VIEWS, type View } from "./positions.js"

/** Where a click put a part: the view and the position props it writes. */
export interface PlacedAt {
  view: View
  props: Readonly<Record<string, number>>
}

const SURFACE: Record<View, string> = { schematic: "sheet", pcb: "board" }
const VIEW_NAME: Record<View, string> = { schematic: "schematic", pcb: "board" }
const UNIT: Record<View, string> = { schematic: "", pcb: " mm" }
const STARTING_VALUE = " It has a starting value; change it on the right."
const ENGINE_PLACED = " Studio placed it for now; open the schematic or the PCB and drag it where it goes."
const KEYBOARD_PLACED = " Studio picked its spot; drag it where it goes, or pick it with the pointer and click where it goes."

/** Why a part was placed without a click: no canvas was open, or the Place button was pressed with the keyboard. */
export type AtOnceReason = "noCanvas" | "keyboard"

/** A Place button activated by the keyboard (a click with detail 0) places at once; a pointer click arms the part. */
export const placeAtOnce = (detail: number): boolean => detail === 0
/** Decimals a toast shows of a position. */
const SHOWN_DECIMALS = 2

/** The status hint while a part is armed. */
export const placeHint = (view: View, part: string): string => `Click on the ${SURFACE[view]} to place ${part} (Esc cancels)`

/** The position props of a click at `world`: on the grid while Snap is on, rounded as a drag rounds. */
export function placedPosition(view: View, world: Point, step: number, snap: boolean): Record<string, number> {
  const at = snapPoint(world, step, snap)
  const [keyX, keyY] = VIEWS[view].position
  return { [keyX]: at.x, [keyY]: at.y }
}

/** The props a place request sends: the part's starting props, then the position, if any. */
export function placeRequest(part: string, position: Readonly<Record<string, number>> = {}): Record<string, Literal> {
  return { ...placeDefaults(part), ...position }
}

const shown = (value: number | undefined): string => String(Number((value ?? 0).toFixed(SHOWN_DECIMALS)))

/** What to tell the person after a place: where it went in the open view, or that the engine placed it. */
export function placedToast(name: string, at: PlacedAt | undefined, startingValue: boolean, reason: AtOnceReason = "noCanvas"): string {
  const value = startingValue ? STARTING_VALUE : ""
  if (!at) return `Placed ${name}.${value}${reason === "keyboard" ? KEYBOARD_PLACED : ENGINE_PLACED}`
  const [keyX, keyY] = VIEWS[at.view].position
  return `Placed ${name} at ${shown(at.props[keyX])}, ${shown(at.props[keyY])}${UNIT[at.view]} on the ${VIEW_NAME[at.view]}.${value}`
}
