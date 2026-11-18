// Placing with the board fitted afterwards: a part that finds no free spot on the board as it is does not stay
// unplaced when the board is to be reshaped round the parts anyway. The board is grown and the constructive pass tried
// again (cheap: no refinement) until every such part has a spot or the growths run out; the whole placement then runs
// once on that board. Fitting the board round the written positions shrinks it back to the parts.
import type { Design } from "../design.js"
import type { Point } from "../model.js"
import { MIN_OUTLINE_POINTS } from "../board.js"
import { OUT_OF_TIME } from "./constructive.js"
import { boxOfPoints, isRectangle } from "./geometry.js"
import { placeBoard, type PlaceOptions, type Placement } from "./index.js"

/** How many times the board is grown before the parts still without a spot are given up. */
export const MAX_GROWTHS = 4
/** Room added round a part's courtyard when the board grows for it, in mm. */
const GROWTH_SLACK = 1

const mm = (v: number): string => String(Math.round(v * 10) / 10)

/** The parts the placer found no room for (not those the time budget left). */
const noRoom = (placement: Placement): string[] => placement.unplaced.filter((u) => u.reason !== OUT_OF_TIME).map((u) => u.name)

/** The board's rectangle, or undefined for a board that is not one (it cannot be grown and fitted). */
function rectangleOf(design: Design): { minX: number; minY: number; maxX: number; maxY: number } | undefined {
  const outline = design.pcb.board?.outline ?? []
  if (outline.length < MIN_OUTLINE_POINTS || !isRectangle(outline)) return undefined
  return boxOfPoints(outline)
}

/** The largest side of the named parts' courtyards, plus the slack and the edge clearance on both sides. */
function growthFor(design: Design, names: readonly string[]): number {
  const wanted = new Set(names)
  const sides = design.pcb.parts
    .filter((part) => wanted.has(part.component) && part.courtyard.length > 0)
    .map((part) => {
      const b = boxOfPoints(part.courtyard)
      return Math.max(b.maxX - b.minX, b.maxY - b.minY)
    })
  return Math.max(0, ...sides) + GROWTH_SLACK + 2 * design.rules.fabrication.boardEdgeClearance
}

/** The design with its rectangular board grown by `by` mm in width and height about its centre. */
function grown(design: Design, by: number): Design {
  const b = rectangleOf(design)
  const board = design.pcb.board
  if (b === undefined || board === undefined) return design
  const half = by / 2
  const outline: Point[] = [
    { x: b.minX - half, y: b.minY - half },
    { x: b.maxX + half, y: b.minY - half },
    { x: b.maxX + half, y: b.maxY + half },
    { x: b.minX - half, y: b.maxY + half },
  ]
  return { ...design, pcb: { ...design.pcb, board: { ...board, outline } } }
}

const sizeOf = (design: Design): string => {
  const b = rectangleOf(design)
  return b === undefined ? "" : `${mm(b.maxX - b.minX)} x ${mm(b.maxY - b.minY)} mm`
}

/** The time left of the budget, in ms; undefined without a budget. */
type Remaining = () => number | undefined

/**
 * The board the constructive pass places every part on, grown at most MAX_GROWTHS times (the last tried otherwise);
 * each pass gets only what is left of the budget, and undefined is returned once nothing is left.
 */
function roomyBoard(design: Design, options: PlaceOptions, missing: readonly string[], remaining: Remaining): Design | undefined {
  let board = design
  let left = missing
  for (let growth = 0; growth < MAX_GROWTHS && left.length > 0; growth++) {
    const budget = remaining()
    if (budget !== undefined && budget <= 0) return undefined
    board = grown(board, growthFor(design, left))
    const pass = placeBoard(board, { ...options, refine: false, connectorsAhead: false, ...(budget === undefined ? {} : { budgetMs: budget }) })
    if (pass.unplaced.some((u) => u.reason === OUT_OF_TIME)) return undefined
    left = noRoom(pass)
  }
  return board
}

/** The first placement with the parts that waited for a larger board named as left for lack of time. */
function outOfTime(first: Placement, missing: readonly string[]): Placement {
  const waiting = new Set(missing)
  return { ...first, unplaced: first.unplaced.map((u) => (waiting.has(u.name) ? { ...u, reason: OUT_OF_TIME } : u)), budgetSpent: true }
}

/**
 * placeBoard for a caller that fits the board round the parts afterwards (see the module comment). The placement
 * says in its notes when the board was grown for a part, and the reason of a part still unplaced names the grown area.
 * A board that is not a rectangle, or a placement that left no part for want of room, is placed as placeBoard does.
 * The whole stays within `budgetMs`: when it runs out before a board with room is found, the parts waiting for one
 * are unplaced for lack of time.
 */
export function placeBoardFitting(design: Design, options: PlaceOptions = {}): Placement {
  const clock = options.clock ?? (() => performance.now())
  const began = clock()
  const remaining: Remaining = () => (options.budgetMs === undefined ? undefined : Math.max(0, options.budgetMs - (clock() - began)))
  const first = placeBoard(design, { ...options, clock })
  const missing = noRoom(first)
  if (missing.length === 0 || rectangleOf(design) === undefined) return first
  const board = roomyBoard(design, { ...options, clock }, missing, remaining)
  const budget = remaining()
  if (board === undefined || (budget !== undefined && budget <= 0)) return outOfTime(first, missing)
  const placement = placeBoard(board, { ...options, ...(budget === undefined ? {} : { budgetMs: budget }), clock })
  const still = noRoom(placement)
  const placedNow = missing.filter((name) => !still.includes(name))
  const note =
    placedNow.length > 0
      ? `The ${sizeOf(design)} board had no free spot for ${placedNow.join(", ")}, so the parts were placed on a board grown to ${sizeOf(board)}`
      : `${missing.join(", ")} found no free spot even on a board grown to ${sizeOf(board)}`
  return { ...placement, notes: [note, ...placement.notes] }
}
