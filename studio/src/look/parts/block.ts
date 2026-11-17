// A relay or any other through-hole block: a box in its kind's colour on the body outline (or the courtyard, a little
// inside it), with a lead through each of its holes; and the plain box for anything not in a family. Pure.
import { clipPieces } from "./chip.js"
import { box, clipped, grown, type Piece } from "./kit.js"
import { leads, type ShapeInput } from "./input.js"

const INSET = 0.15

export function blockShape(input: ShapeInput): Piece[] {
  const body = clipped(input.body ?? grown(input.limit, -INSET), input.limit)
  const { look } = input
  return [...clipPieces(box(body, 0, input.height, { top: look.top ?? look.body, side: look.body }, "matt", "body"), input.limit), ...leads(input)]
}

/** The box a part is when it is in no family: its courtyard's bounds, as tall as it is. */
export function plainBox(input: ShapeInput): Piece[] {
  return box(input.limit, 0, input.height, input.look.body, "matt", "body")
}
