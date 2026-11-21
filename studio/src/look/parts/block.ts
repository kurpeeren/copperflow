// A relay or any other through-hole block: a box in its kind's colour on the body outline (or the courtyard, a little
// inside it), with a lead through each of its holes; and the plain box for anything not in a family. A block whose
// look says more is drawn as that: a relay as a relay, a terminal with one row of holes and a front as a pluggable
// header, a diode with two holes in a row as an axial diode. Pure.
import { axialShape } from "./axial.js"
import { clipPieces } from "./chip.js"
import { box, clipped, grown, type Piece } from "./kit.js"
import { leads, type ShapeInput } from "./input.js"
import { plugShape } from "./plug.js"
import { relayShape } from "./relay.js"

const INSET = 0.15

/** Two holes on one line along x: the shape an axial part lies on. */
const axialPads = (input: ShapeInput): boolean =>
  input.pads.length === 2 && input.pads.every((pad) => pad.layers === "through" && Math.abs(pad.y - (input.pads[0]?.y as number)) < 1e-3)

export function blockShape(input: ShapeInput): Piece[] {
  if (input.lookName === "relay") return relayShape(input)
  if (input.lookName === "terminal") {
    const plug = plugShape(input)
    if (plug !== undefined) return plug
  }
  if (input.lookName === "axialDiode" && axialPads(input)) return axialShape(input)
  const body = clipped(input.body ?? grown(input.limit, -INSET), input.limit)
  const { look } = input
  return [...clipPieces(box(body, 0, input.height, { top: look.top ?? look.body, side: look.body }, "matt", "body"), input.limit), ...leads(input)]
}

/** The box a part is when it is in no family: its courtyard's bounds, as tall as it is. */
export function plainBox(input: ShapeInput): Piece[] {
  return box(input.limit, 0, input.height, input.look.body, "matt", "body")
}
