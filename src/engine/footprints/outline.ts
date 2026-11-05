import type { Point } from "../model.js"
import { roundUpToStep, type GoalTable } from "./ipc7351.js"
import type { Pad } from "./types.js"

/** Half sizes of a box centred on the footprint origin. */
export interface Extent {
  x: number
  y: number
}

/** Engine plan: silkscreen keeps this far from copper. */
export const SILK_CLEARANCE = 0.15
const TIDY = 1e6

/** Removes floating-point noise below 1 nm, and turns −0 into 0. */
export function tidy(value: number): number {
  return Math.round(value * TIDY) / TIDY + 0
}

/** `count` positions `pitch` apart, centred on 0, in rising order. */
export function centredOffsets(count: number, pitch: number): number[] {
  return Array.from({ length: count }, (_, i) => tidy((i - (count - 1) / 2) * pitch))
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

/** Half the gap between two rows of pads: how far the nearest pad edge is from the centre line across `axis`. */
function innerEdge(pads: readonly Pad[], axis: "x" | "y" = "x"): number {
  return Math.min(...pads.map((pad) => Math.abs(pad[axis]) - padHalfSize(pad)[axis]))
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

/** A rectangle around the origin as a closed polyline. */
export function closedRectangle(half: Extent): Point[] {
  const clean = { x: tidy(half.x), y: tidy(half.y) }
  return [...rectangle(clean), { x: -clean.x, y: -clean.y }]
}

/** The body outline as a closed polyline. */
export function bodyOutline(body: Extent): Point[][] {
  return [closedRectangle(body)]
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

/**
 * Two columns of pads (SOIC, TSSOP): lines along the top and bottom body edges between the columns.
 * The top line runs on over pad 1, at the top of the left column, to mark it.
 */
export function dualSilkscreen(pads: readonly Pad[], body: Extent): Point[][] {
  const [top, bottom] = sideLines(pads, body) as [[Point, Point], Point[]]
  const [, end] = top
  return [[{ x: -tidy(padExtent(pads).x), y: end.y }, end], bottom]
}

/**
 * Two rows of pads (SOT-23): lines along the left and right body edges between the rows. The left
 * line runs on past pad 1, at the left of the bottom row, to mark it.
 */
export function rowSilkscreen(pads: readonly Pad[], body: Extent): Point[][] {
  const extent = padExtent(pads)
  const x = tidy(Math.max(body.x, extent.x + SILK_CLEARANCE))
  const y = tidy(Math.min(body.y, innerEdge(pads, "y")))
  return [
    [{ x: -x, y: -tidy(extent.y) }, { x: -x, y }],
    [{ x, y: -y }, { x, y }],
  ]
}

/** How far along its side of a square package a pad reaches from the centre line. */
function alongSide(pad: Pad): number {
  const half = padHalfSize(pad)
  return Math.abs(pad.x) > Math.abs(pad.y) ? Math.abs(pad.y) + half.y : Math.abs(pad.x) + half.x
}

/**
 * Four sides of pads (QFP, QFN; pass the signal pads only): an L at each body corner, clear of the
 * pads. The top-left L runs on to the outer end of pad 1, at the top of the left side, to mark it.
 */
export function quadSilkscreen(pads: readonly Pad[], body: Extent): Point[][] {
  const start = tidy(Math.max(...pads.map(alongSide)) + SILK_CLEARANCE)
  const c = tidy(Math.max(body.x, start))
  const corner = (sx: number, sy: number): Point[] => [
    { x: tidy(sx * c), y: tidy(sy * start) },
    { x: tidy(sx * c), y: tidy(sy * c) },
    { x: tidy(sx * start), y: tidy(sy * c) },
  ]
  return [
    [{ x: -c, y: start }, { x: -c, y: c }],
    [{ x: -tidy(padExtent(pads).x), y: c }, { x: -start, y: c }],
    corner(1, 1),
    corner(1, -1),
    corner(-1, -1),
  ]
}
