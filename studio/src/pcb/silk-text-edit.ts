// The board's silkscreen texts in the Studio, as plain data: the drag that moves one (pressed, past the threshold,
// released), where it shows the text meanwhile, and the one edit its release writes. Pure; plain TypeScript with .js
// imports, so the tests run it.
import { isBoardGraphicId } from "../../../src/core/board-items.js"
import type { Edit } from "../../../src/core/types.js"
import type { SilkText } from "../../../src/engine/model.js"
import type { Point } from "./geometry.js"

/** A board text being dragged: where the press was, where the pointer is, and whether it has passed the threshold yet. */
export interface SilkTextDrag {
  id: string
  start: Point
  to: Point
  moved: boolean
}

/** Puts a point on the grid while Snap is on; leaves it as it is otherwise. */
export type Snap = (p: Point) => Point

/** Positions are written to a micrometre, as the other board items are. */
const DIGITS = 1e3

const round = (value: number) => Math.round(value * DIGITS) / DIGITS
const asIs: Snap = (p) => p

/** Where the drag puts the text's middle (on the grid while Snap is on), or undefined before it has moved. */
export function draggedPlace(text: Pick<SilkText, "x" | "y">, drag: SilkTextDrag | undefined, snap: Snap = asIs): Point | undefined {
  if (!drag?.moved) return undefined
  const at = snap({ x: text.x + drag.to.x - drag.start.x, y: text.y + drag.to.y - drag.start.y })
  return { x: round(at.x), y: round(at.y) }
}

/** How far the canvas shows the dragged text moved, in mm. */
export function dragOffset(text: Pick<SilkText, "x" | "y">, drag: SilkTextDrag | undefined, snap: Snap = asIs): Point | undefined {
  const at = draggedPlace(text, drag, snap)
  return at && { x: at.x - text.x, y: at.y - text.y }
}

/** The edit a finished drag writes: the text's new middle, or undefined when it did not move. */
export function silkTextMove(text: Pick<SilkText, "id" | "x" | "y">, drag: SilkTextDrag, snap: Snap = asIs): { edit: Edit; summary: string } | undefined {
  const at = draggedPlace(text, drag, snap)
  if (!at || (at.x === text.x && at.y === text.y)) return undefined
  const kind = isBoardGraphicId(text.id) ? "setBoardGraphic" : "setSilkText"
  return { edit: { kind, id: text.id, props: { x: at.x, y: at.y } }, summary: `move ${text.id} to (${at.x}, ${at.y})` }
}
