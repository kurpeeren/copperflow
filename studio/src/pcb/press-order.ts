// The order a press on the PCB is offered to what lies under it: an armed pour or hole tool takes it first, then the
// routing tools, then a corner handle of the selected pour, then (unless a designator takes it) the tracks and vias,
// then a hole or a pour's outline; a press none of them took goes on to the parts and the empty board. Plain
// TypeScript, so the tests run it without a DOM.
import type { Point } from "./geometry.js"
import type { Press } from "./press.js"

/** One taker: true when it took the press. */
type Taker = (event: Press, world: Point) => boolean

export interface PcbPressTakers {
  pourTool: Taker
  route: Taker
  pourCorner: Taker
  /** Whether a part's designator takes the press, so the copper, holes and pours under it do not. */
  text(world: Point): boolean
  copper: Taker
  pour: Taker
}

/** The press hook for the canvas's gestures: true when one of the takers, in their order, took the press. */
export function pcbPress(takers: PcbPressTakers): Taker {
  return (event, world) =>
    takers.pourTool(event, world) || takers.route(event, world) || takers.pourCorner(event, world) || (!takers.text(world) && (takers.copper(event, world) || takers.pour(event, world)))
}
