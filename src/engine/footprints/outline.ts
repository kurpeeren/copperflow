import type { Point } from "../model.js"
import { roundUpToStep, type GoalTable } from "./ipc7351.js"
import type { Pad } from "./types.js"

/** Half sizes of a box centred on the footprint origin. */
export interface Extent {
  x: number
  y: number
}

/** Engine plan: silkscreen keeps this far from copper. */
const SILK_CLEARANCE = 0.15
const TIDY = 1e6

/** Removes floating-point noise below 1 nm. */
function tidy(value: number): number {
  return Math.round(value * TIDY) / TIDY
}

function padHalfSize(pad: Pad): Extent {
  const quarterTurn = Math.abs(pad.rotation % 180) === 90
  return quarterTurn ? { x: pad.height / 2, y: pad.width / 2 } : { x: pad.width / 2, y: pad.height / 2 }
}

/** The smallest box around the origin that holds every pad. */
export function padExtent(pads: readonly Pad[]): Extent {
  return pads.reduce<Extent>((acc, pad) => {
    const half = padHalfSize(pad)
    return { x: Math.max(acc.x, Math.abs(pad.x) + half.x), y: Math.max(acc.y, Math.abs(pad.y) + half.y) }
  }, { x: 0, y: 0 })
}

/** Half the gap between the pads of a two-terminal pattern: how far the nearest pad edge is from x = 0. */
function innerEdge(pads: readonly Pad[]): number {
  return Math.min(...pads.map((pad) => Math.abs(pad.x) - padHalfSize(pad).x))
}

/** A rectangle's corners, counter-clockwise from the lower left. */
export function rectangle(half: Extent): Point[] {
  return [
    { x: -half.x, y: -half.y },
    { x: half.x, y: -half.y },
    { x: half.x, y: half.y },
    { x: -half.x, y: half.y },
  ]
}

/**
 * A rectangle around the larger of the pads and the component, plus the table's courtyard excess,
 * with each half size rounded up to the table's round-off step. [IPC-7351] §3.1.5.4 (p. 15) adds the
 * excess to the larger extremity, rounds the courtyard up by the table's round-off and suggests
 * keeping the size even so that the centre falls on the step; rounding each half up does both. The
 * IPC-7351B wording was not seen.
 */
export function courtyard(pads: readonly Pad[], component: Extent, table: Readonly<GoalTable>): Point[] {
  const pad = padExtent(pads)
  return rectangle({
    x: roundUpToStep(Math.max(pad.x, component.x) + table.courtyardExcess, table.roundOff),
    y: roundUpToStep(Math.max(pad.y, component.y) + table.courtyardExcess, table.roundOff),
  })
}

/** The body outline as a closed polyline. */
export function bodyOutline(body: Extent): Point[][] {
  const half = { x: tidy(body.x), y: tidy(body.y) }
  return [[...rectangle(half), { x: -half.x, y: -half.y }]]
}

/** How far above and below the origin silkscreen lines run: at the body edge, but clear of the pads. */
function silkY(pads: readonly Pad[], body: Extent): number {
  return tidy(Math.max(body.y, padExtent(pads).y + SILK_CLEARANCE))
}

/** Two lines along the body, above and below it, between the pads. */
export function sideLines(pads: readonly Pad[], body: Extent): Point[][] {
  const y = silkY(pads, body)
  const x = tidy(Math.min(body.x, innerEdge(pads)))
  return [
    [{ x: -x, y }, { x, y }],
    [{ x: -x, y: -y }, { x, y: -y }],
  ]
}

/**
 * A bar across the body on the pad 2 side, which is the cathode of a diode: just inside pad 2 when
 * the gap leaves room, otherwise just outside it.
 */
export function cathodeBar(pads: readonly Pad[], body: Extent): Point[] {
  const inside = innerEdge(pads) - SILK_CLEARANCE
  const x = tidy(inside > 0 ? inside : padExtent(pads).x + SILK_CLEARANCE)
  const y = silkY(pads, body)
  return [{ x, y: -y }, { x, y }]
}
