import type { Point } from "../model.js"
import { tidy } from "./outline.js"
import type { Pad } from "./types.js"

/**
 * Small helpers shared by the connector, jack and switch families whose holes and lands are read from a maker's
 * drawing: plated slots, round through-hole pads with a given hole, and the mark for the side a plug enters from.
 */

/** Land around a given hole: the hole + 2 × 0.05 mm annular ring + 0.50 mm fabrication allowance (as ipc7251.ts). */
const LAND_OVER_HOLE = 0.6
const ROUND_OFF = 0.05

/** The round land for a hole of this diameter, rounded up to 0.05 mm. */
export const landFor = (hole: number): number => tidy(Math.ceil(tidy((hole + LAND_OVER_HOLE) / ROUND_OFF)) * ROUND_OFF)

/** A round through-hole pad (square for pin 1) with this hole, its land from `landFor`. */
export function holePad(number: string, x: number, y: number, hole: number, square = false): Pad {
  const land = landFor(hole)
  return { number, shape: square ? "rect" : "circle", x: tidy(x), y: tidy(y), width: land, height: land, rotation: 0, layers: "through", drill: { width: hole, height: hole } }
}

/** A plated slot: an oval land `land` (x, y) around an oval hole `hole` (x, y). */
export function slotPad(number: string, x: number, y: number, land: { x: number; y: number }, hole: { x: number; y: number }): Pad {
  return { number, shape: "oval", x: tidy(x), y: tidy(y), width: land.x, height: land.y, rotation: 0, layers: "through", drill: { width: hole.x, height: hole.y } }
}

/** Length of the mating-side arrow on the fabrication layer, and of its head. */
const ARROW = 1.5
const HEAD = 0.5

/** An arrow on the fabrication layer pointing into the body from its −y edge at `front`: the side the plug enters from. */
export function matingArrow(front: number): Point[][] {
  const tip = tidy(front + ARROW)
  return [
    [{ x: 0, y: tidy(front) }, { x: 0, y: tip }],
    [{ x: -HEAD, y: tidy(tip - HEAD) }, { x: 0, y: tip }, { x: HEAD, y: tidy(tip - HEAD) }],
  ]
}
