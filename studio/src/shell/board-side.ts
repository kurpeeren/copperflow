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
  /** The page's place in the schematic's order: each page is laid out in its own region of the board. */
  page?: number
  /** The symbol's rotation in degrees, which the part takes on the board. */
  rotation?: number
}

/** Millimetres between the regions of two pages, so no page's parts land on another's. */
export const PAGE_GAP_MM = 10

export type PlanResult = { edits: Edit[]; summary: string; skipped: string[] } | { message: string }

/** Millimetres of board per sheet unit: a symbol one sheet unit from another lands a little over a centimetre away. */
export const TRANSFER_SCALE = 12.7

const tidy = (value: number): number => Math.round(value * 1000) / 1000 + 0

/** Why a part cannot change here, or undefined when it can. */
function whyNot(name: string, parts: readonly Pick<PartInfo, "name" | "editable">[], locked: ReadonlySet<string>): string | undefined {
  const part = parts.find((candidate) => candidate.name === name)
  if (!part) return "inside a sub-sheet; change it in its sheet"
  if (locked.has(name)) return "locked"
  return part.editable ? undefined : "read-only"
}

/** The parts that may change, and those left out, each with why. */
function editable(names: readonly string[], parts: readonly Pick<PartInfo, "name" | "editable">[], locked: ReadonlySet<string>): { ok: string[]; skipped: string[] } {
  const ok: string[] = []
  const skipped: string[] = []
  for (const name of names) {
    const why = whyNot(name, parts, locked)
    if (why === undefined) ok.push(name)
    else skipped.push(`${name} (${why})`)
  }
  return { ok, skipped }
}

const and = (skipped: readonly string[]): string => (skipped.length === 0 ? "" : `; left ${skipped.join(", ")}`)

/** Layout → Flip: each selected part to the other side, its position written when it had none. */
export function flipPlan(names: readonly string[], board: readonly BoardPart[], parts: readonly Pick<PartInfo, "name" | "editable" | "props">[], locked: ReadonlySet<string>): PlanResult {
  const placed = names.filter((name) => board.some((part) => part.component === name))
  if (placed.length === 0) return { message: "Select a part on the PCB to flip." }
  const { ok, skipped } = editable(placed, parts, locked)
  if (ok.length === 0) return { message: `Cannot flip ${skipped.join(", ")}.` }
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

const middleOf = (list: readonly { x: number; y: number }[]) => ({ x: list.reduce((sum, p) => sum + p.x, 0) / list.length, y: list.reduce((sum, p) => sum + p.y, 0) / list.length })

/**
 * Each page's spots as offsets in mm from the middle of all of them: a page keeps its own arrangement, scaled by
 * TRANSFER_SCALE, and the pages stand side by side, left to right in page order, PAGE_GAP_MM apart.
 */
function pageOffsets(spots: readonly SheetSpot[]): Map<string, { x: number; y: number }> {
  const pages = [...new Set(spots.map((spot) => spot.page ?? 0))].sort((a, b) => a - b)
  const placed = new Map<string, { x: number; y: number }>()
  let left = 0
  for (const page of pages) {
    const own = spots.filter((spot) => (spot.page ?? 0) === page)
    const minX = Math.min(...own.map((spot) => spot.x))
    const maxX = Math.max(...own.map((spot) => spot.x))
    const midY = middleOf(own).y
    for (const spot of own) placed.set(spot.component, { x: left + (spot.x - minX) * TRANSFER_SCALE, y: (spot.y - midY) * TRANSFER_SCALE })
    left += (maxX - minX) * TRANSFER_SCALE + PAGE_GAP_MM
  }
  const centre = middleOf([...placed.values()])
  return new Map([...placed].map(([name, at]) => [name, { x: at.x - centre.x, y: at.y - centre.y }]))
}

/**
 * Design → Placement transfer: the parts (the selection, or every part) placed as their symbols are, each page in its
 * own region (pageOffsets), turned as their symbols are, about the middle of where they are on the board now.
 */
export function transferPlan(names: readonly string[], sheet: readonly SheetSpot[], board: readonly BoardPart[], parts: readonly Pick<PartInfo, "name" | "editable">[], locked: ReadonlySet<string>): PlanResult {
  const both = names.filter((name) => sheet.some((spot) => spot.component === name) && board.some((part) => part.component === name))
  if (both.length === 0) return { message: "No part is on both the schematic and the PCB." }
  const { ok, skipped } = editable(both, parts, locked)
  if (ok.length === 0) return { message: `${skipped.join(", ")} cannot move: locked or read-only.` }
  const spots = ok.map((name) => sheet.find((spot) => spot.component === name) as SheetSpot)
  const offsets = pageOffsets(spots)
  const boardMiddle = middleOf(ok.map((name) => board.find((part) => part.component === name) as BoardPart))
  const edits = spots.map((spot): Edit => {
    const at = offsets.get(spot.component) as { x: number; y: number }
    const turn = spot.rotation === undefined ? {} : { pcbRotation: spot.rotation }
    return { kind: "setProps", part: spot.component, props: { pcbX: tidy(boardMiddle.x + at.x), pcbY: tidy(boardMiddle.y + at.y), ...turn } }
  })
  return { edits, summary: `place ${ok.length === 1 ? ok[0] : `${ok.length} parts`} as on the schematic${and(skipped)}`, skipped }
}
