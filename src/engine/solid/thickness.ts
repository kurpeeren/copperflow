// The board's thickness for the STEP file and the 3D view, in this order: the thickness the circuit gives its board,
// then the rules' fabrication.boardThickness (the fabrication profile or rules.yaml), then 1.6 mm.
import { DEFAULT_THICKNESS } from "../board.js"
import type { Board } from "../model.js"

export function boardThickness(design: { pcb: { board?: Board }; rules?: { fabrication?: { boardThickness?: number } } }): number {
  const board = design.pcb.board
  if (board?.thicknessGiven) return board.thickness
  return design.rules?.fabrication?.boardThickness ?? DEFAULT_THICKNESS
}
