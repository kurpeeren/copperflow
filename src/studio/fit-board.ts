// Layout → Fit board and the agent's fit_board: the board's rectangle round the placed parts as one setBoard edit.
import type { Edit } from "../core/types.js"
import type { Design } from "../engine/design.js"
import { DEFAULT_FIT_MARGIN, fitBoard } from "../engine/pcb-place/index.js"

const mm = (v: number) => String(Math.round(v * 10) / 10)

/** The edit that fits the board round the parts with `margin` mm, and its summary ("Fit board: 42 × 28 mm"); or why not. */
export function fitBoardEdit(design: Design, margin = DEFAULT_FIT_MARGIN): { edit: Edit; summary: string; width: number; height: number } | { error: string } {
  const fit = fitBoard(design, margin)
  if ("error" in fit) return { error: `The board was not fitted: ${fit.error}` }
  return {
    edit: { kind: "setBoard", width: fit.width, height: fit.height, x: fit.centre.x, y: fit.centre.y, ...(fit.holes ?? {}) },
    summary: fit.holes ? `Fit board: ${fit.holes.columns} × ${fit.holes.rows} holes` : `Fit board: ${mm(fit.width)} × ${mm(fit.height)} mm`,
    width: fit.width,
    height: fit.height,
  }
}
