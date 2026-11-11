import { MIN_OUTLINE_POINTS } from "../board.js"
import type { Design } from "../design.js"
import type { Point } from "../model.js"
import { boxOfPoints, isRectangle } from "./geometry.js"

/** The margin round the parts when none is given, in mm. */
export const DEFAULT_FIT_MARGIN = 2
/** The outline's corners are rounded outward to this step (mm), so the file gets short numbers. */
const STEP = 0.1

/** A rectangular outline round the placed parts: its corners, size and centre; or why there is none. */
export type FitBoard = { outline: Point[]; width: number; height: number; centre: Point } | { error: string }

const down = (v: number) => Math.floor(v / STEP + 1e-9) * STEP
const up = (v: number) => Math.ceil(v / STEP - 1e-9) * STEP
const tidy = (v: number) => Math.round(v * 1e6) / 1e6

/**
 * Call it on the design rebuilt with the placement written: it fits whatever the design holds, auto-placed parts the
 * build packed off the board included. Keepouts are not kept inside.
 *
 * The rectangle that holds every part's courtyard and every hole with `margin` to spare (at least the edge
 * clearance), its corners rounded outward to 0.1 mm: the board shrunk or grown to the parts. Refused for an outline
 * that is not a rectangle, and for a design without parts.
 */
export function fitBoard(design: Design, margin = DEFAULT_FIT_MARGIN): FitBoard {
  const outline = design.pcb.board?.outline ?? []
  if (outline.length >= MIN_OUTLINE_POINTS && !isRectangle(outline)) return { error: "fitBoard only reshapes a rectangular board; this outline is not one" }
  if (!(margin >= 0)) return { error: `the margin must be 0 or more, got ${margin}` }
  const points = [
    ...design.pcb.parts.flatMap((p) => p.courtyard),
    ...design.pcb.holes.flatMap((h) => [
      { x: h.x - h.diameter / 2, y: h.y - h.diameter / 2 },
      { x: h.x + h.diameter / 2, y: h.y + h.diameter / 2 },
    ]),
  ]
  if (points.length === 0) return { error: "there are no parts to fit the board to" }
  const gap = Math.max(margin, design.rules.fabrication.boardEdgeClearance)
  const b = boxOfPoints(points)
  const [minX, minY, maxX, maxY] = [tidy(down(b.minX - gap)), tidy(down(b.minY - gap)), tidy(up(b.maxX + gap)), tidy(up(b.maxY + gap))]
  return {
    outline: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
    width: tidy(maxX - minX),
    height: tidy(maxY - minY),
    centre: { x: tidy((minX + maxX) / 2), y: tidy((minY + maxY) / 2) },
  }
}
