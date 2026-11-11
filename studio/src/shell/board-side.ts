// Layout → Flip and Design → Placement transfer, as plain data: the setProps edits each writes, as one history entry.
// Flip puts the selected parts on the other side of the board (`layer="bottom"`, which the engine mirrors and the
// fabrication files export on the bottom), writing the position the part has now when it had none of its own.
// Placement transfer places PCB parts in the arrangement their symbols have on the schematic, about the middle of where
// they are now. Locked parts are left as they are and named. Pure.
import type { Edit, PartInfo, PropValue } from "../../../src/core/types.js"

export interface BoardPart {
  component: string
  x: number
  y: number
  side: "top" | "bottom"
}

export interface SheetSpot {
  component: string
  x: number
  y: number
}

export type PlanResult = { edits: Edit[]; summary: string; skipped: string[] } | { message: string }

/** Millimetres of board per sheet unit: a symbol one sheet unit from another lands a little over a centimetre away. */
export const TRANSFER_SCALE = 12.7

const tidy = (value: number): number => Math.round(value * 1000) / 1000 + 0

/** The parts that may change, and those left out because they are locked or not in this file. */
function editable(names: readonly string[], parts: readonly Pick<PartInfo, "name" | "editable">[], locked: ReadonlySet<string>): { ok: string[]; skipped: string[] } {
  const ok: string[] = []
  const skipped: string[] = []
  for (const name of names) {
    const part = parts.find((candidate) => candidate.name === name)
    if (part && part.editable && !locked.has(name)) ok.push(name)
    else skipped.push(name)
  }
  return { ok, skipped }
}

const and = (skipped: readonly string[]): string => (skipped.length === 0 ? "" : `; left ${skipped.join(", ")} (locked or read-only)`)

/** Layout → Flip: each selected part to the other side, its position written when it had none. */
export function flipPlan(names: readonly string[], board: readonly BoardPart[], parts: readonly Pick<PartInfo, "name" | "editable" | "props">[], locked: ReadonlySet<string>): PlanResult {
  const placed = names.filter((name) => board.some((part) => part.component === name))
  if (placed.length === 0) return { message: "Select a part on the PCB to flip." }
  const { ok, skipped } = editable(placed, parts, locked)
  if (ok.length === 0) return { message: `${skipped.join(", ")} cannot be flipped: locked or read-only.` }
  const edits = ok.map((name): Edit => {
    const at = board.find((part) => part.component === name) as BoardPart
    const props = parts.find((part) => part.name === name)?.props ?? {}
    const position: Record<string, PropValue> = props["pcbX"] || props["pcbY"] ? {} : { pcbX: tidy(at.x), pcbY: tidy(at.y) }
    return { kind: "setProps", part: name, props: { layer: at.side === "bottom" ? "top" : "bottom", ...position } }
  })
  const sides = new Set(ok.map((name) => board.find((part) => part.component === name)?.side))
  const to = sides.size === 1 ? (sides.has("bottom") ? " to the top" : " to the bottom") : ""
  return { edits, summary: `flip ${ok.join(", ")}${to}${and(skipped)}`, skipped }
}

/**
 * Design → Placement transfer: the parts (the selection, or every part) placed as their symbols are, scaled by
 * TRANSFER_SCALE, about the middle of where they are on the board now.
 */
export function transferPlan(names: readonly string[], sheet: readonly SheetSpot[], board: readonly BoardPart[], parts: readonly Pick<PartInfo, "name" | "editable">[], locked: ReadonlySet<string>): PlanResult {
  const both = names.filter((name) => sheet.some((spot) => spot.component === name) && board.some((part) => part.component === name))
  if (both.length === 0) return { message: "No part is on both the schematic and the PCB." }
  const { ok, skipped } = editable(both, parts, locked)
  if (ok.length === 0) return { message: `${skipped.join(", ")} cannot move: locked or read-only.` }
  const middle = (list: readonly { x: number; y: number }[]) => ({ x: list.reduce((sum, p) => sum + p.x, 0) / list.length, y: list.reduce((sum, p) => sum + p.y, 0) / list.length })
  const spots = ok.map((name) => sheet.find((spot) => spot.component === name) as SheetSpot)
  const sheetMiddle = middle(spots)
  const boardMiddle = middle(ok.map((name) => board.find((part) => part.component === name) as BoardPart))
  const edits = spots.map((spot): Edit => ({
    kind: "setProps",
    part: spot.component,
    props: { pcbX: tidy(boardMiddle.x + (spot.x - sheetMiddle.x) * TRANSFER_SCALE), pcbY: tidy(boardMiddle.y + (spot.y - sheetMiddle.y) * TRANSFER_SCALE) },
  }))
  return { edits, summary: `place ${ok.length === 1 ? ok[0] : `${ok.length} parts`} as on the schematic${and(skipped)}`, skipped }
}
