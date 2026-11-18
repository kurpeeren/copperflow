import type { Point } from "../model.js"
import { roundRectPad } from "./ipc7351.js"
import { padExtent, runsClearOf, SILK_CLEARANCE, tidy } from "./outline.js"
import { isSimple, type ParsedFootprint } from "./parse.js"
import type { Pad } from "./types.js"

/**
 * Small helpers shared by the fixed-land families (crystals, LEDs, cans): the land patterns there
 * are read from a maker's drawing or written as typical values, not computed by IPC-7351B.
 */

/** Courtyard 0.25 mm around the larger of the pads and the body, rounded up to 0.05 mm (IPC-7351B level B excess). */
export const FIXED_LAND_COURTYARD = { courtyardExcess: 0.25, roundOff: 0.05 }

/** The pin 1 tick sits this far beyond the silkscreen clearance below the pads; less than the courtyard excess. */
const TICK_GAP = 0.05
const TICK_LENGTH = 1
/** Silkscreen outlines that cross pads are cut into runs; points are this far apart at most. */
const DENSIFY_STEP = 0.05

/** No head extras, variant or parameters: "xtal3225", not "xtal3225_2" or "xtal3225_p1". */
export function isBare(parsed: ParsedFootprint): boolean {
  return isSimple(parsed) && parsed.variant === undefined && Object.keys(parsed.params).length === 0
}

/** A closed or open polyline with points added so no two neighbours are more than `step` apart. */
export function densify(points: readonly Point[], step = DENSIFY_STEP): Point[] {
  const out: Point[] = points.length > 0 ? [points[0] as Point] : []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point
    const b = points[i] as Point
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let k = 1; k <= count; k++) out.push({ x: tidy(a.x + ((b.x - a.x) * k) / count), y: tidy(a.y + ((b.y - a.y) * k) / count) })
  }
  return out
}

/** Points closer than this to the line through their neighbours are dropped by `thin`. */
const STRAIGHT = 1e-6

/** The polyline without the points that lie on the straight line between their neighbours. */
export function thin(points: readonly Point[]): Point[] {
  return points.filter((point, i) => {
    const before = points[i - 1]
    const after = points[i + 1]
    if (!before || !after) return true
    const length = Math.hypot(after.x - before.x, after.y - before.y)
    if (length === 0) return false
    const cross = (after.x - before.x) * (point.y - before.y) - (after.y - before.y) * (point.x - before.x)
    return Math.abs(cross) / length > STRAIGHT
  })
}

/**
 * The parts of an outline that keep the silkscreen clearance from every pad: cut on a dense copy,
 * then thinned back to the outline's own corners and the cut ends.
 */
export function clearOutline(points: readonly Point[], pads: readonly Pad[]): Point[][] {
  return runsClearOf(densify(points), pads).map(thin)
}

/** A short line under pad 1, just below the lowest pad edge plus the silkscreen clearance. */
export function tickBelow(pads: readonly Pad[], pinOne: Pad): Point[] {
  const y = tidy(-(padExtent(pads).y + SILK_CLEARANCE + TICK_GAP))
  return [
    { x: tidy(pinOne.x - TICK_LENGTH / 2), y },
    { x: tidy(pinOne.x + TICK_LENGTH / 2), y },
  ]
}

/**
 * Two rows of round-rectangle pads, `width` along x and `height` along y: the bottom row at −y
 * numbered 1, 2, … left to right, the top row at +y numbered on right to left, so the numbers run
 * counter-clockwise from the bottom left.
 */
export function rowPads(xs: readonly number[], y: number, width: number, height: number): Pad[] {
  const bottom = xs.map((x, i) => roundRectPad(String(i + 1), tidy(x), tidy(-y), width, height))
  const top = [...xs].reverse().map((x, i) => roundRectPad(String(xs.length + i + 1), tidy(x), tidy(y), width, height))
  return [...bottom, ...top]
}

/** Two pads along x, pad 1 at −x, centres `centre` mm from the origin. */
export function pairPads(centre: number, width: number, height: number): Pad[] {
  return [roundRectPad("1", tidy(-centre), 0, width, height), roundRectPad("2", tidy(centre), 0, width, height)]
}
