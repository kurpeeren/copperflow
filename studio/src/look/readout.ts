// The words the 3D view shows: the readout beside it (the board's size, the tallest part on each side, the total
// height and what the model is not) and the name of the part under the pointer or in focus. Pure.
import { MODEL_LIMITS } from "../../../src/engine/solid/limits.js"
import type { PartSolid, SolidModel } from "../../../src/engine/solid/model.js"

export interface Readout {
  board: string
  top: string
  bottom: string
  total: string
  limits: string
}

/** A length in mm with at most two decimals: 1.45, 8.5, 40. */
export const mm = (value: number): string => String(Math.round(value * 100) / 100)

const tallest = (parts: readonly PartSolid[], side: PartSolid["side"]): PartSolid | undefined =>
  parts.filter((part) => part.side === side).reduce<PartSolid | undefined>((best, part) => (best === undefined || part.height > best.height ? part : best), undefined)

function boardLine(model: SolidModel): string {
  const board = model.board
  if (!board) return "No board outline"
  const xs = board.outline.map((s) => s.from.x)
  const ys = board.outline.map((s) => s.from.y)
  return `Board ${mm(Math.max(...xs) - Math.min(...xs))} × ${mm(Math.max(...ys) - Math.min(...ys))} mm, ${mm(board.thickness)} mm thick`
}

export function lookReadout(model: SolidModel): Readout {
  const [top, bottom] = [tallest(model.parts, "top"), tallest(model.parts, "bottom")]
  const line = (side: string, part: PartSolid | undefined) => `Tallest on ${side}: ${part ? `${part.name}, ${mm(part.height)} mm` : "none"}`
  const thickness = model.board?.thickness ?? 0
  return {
    board: boardLine(model),
    top: line("top", top),
    bottom: line("bottom", bottom),
    total: `Total height: ${mm(thickness + (top?.height ?? 0) + (bottom?.height ?? 0))} mm`,
    limits: MODEL_LIMITS,
  }
}

/** "U1, 1.75 mm high (top)", with "assumed" when the height is a guess. */
export const hoverText = (part: PartSolid): string => `${part.name}, ${mm(part.height)} mm high${part.assumed ? ", assumed" : ""} (${part.side})`
