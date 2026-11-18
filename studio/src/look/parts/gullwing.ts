// A gull-wing chip (SOIC, SOT, TSSOP, QFP): a dark moulded body with a pin 1 dot, and a metal leg from each side of
// the body out over its pad: a shoulder from the body, a bend down, and a foot on the pad. Pure.
import type { Pad } from "../../../../src/engine/footprints/types.js"
import { clipPieces } from "./chip.js"
import { box, circle, clipped, prism, type Piece, type Rect } from "./kit.js"
import { firstPad, padRect, padsRect, type ShapeInput } from "./input.js"

/** Lead thickness, mm. */
const LEAD = 0.15
/** The body stands this far off the board. */
export const STANDOFF = 0.08
/** A leg leaves a tall body no higher than this above the board, mm (a short body's is 0.38 of its height). */
const SHOULDER_MOST = 1.05
/** The body's lowest and highest z for a part `height` high: the usual standoff and top gap, less on a very low part. */
export function bodyBand(height: number): { bottom: number; top: number } {
  return { bottom: Math.min(STANDOFF, height * 0.3), top: height - Math.min(0.02, height * 0.2) }
}

/** A pad whose sides differ by no more than this share of the longer is nearly square. */
const SQUARISH = 0.1
/** The exposed pad's plate is this thick, mm. */
const PLATE = 0.04

type Side = "left" | "right" | "bottom" | "top"

/** The side of the body a pad's leg leaves from: along the pad's long side, away from the centre. */
export function padSide(pad: Pad): Side {
  const r = padRect(pad)
  const [w, h] = [r.maxX - r.minX, r.maxY - r.minY]
  // A nearly square pad (the wide pin 1 of a SOT-143) goes with the axis it is further out on.
  const wide = Math.abs(w - h) <= SQUARISH * Math.max(w, h) ? Math.abs(pad.x) > Math.abs(pad.y) : w >= h
  if (wide) return pad.x >= 0 ? "right" : "left"
  return pad.y >= 0 ? "top" : "bottom"
}

/** The pads that are not under the body: an exposed pad has its centre inside the body outline and gets no leg. */
export function legPads(input: ShapeInput): readonly Pad[] {
  const body = input.body
  if (body === undefined) return input.pads
  const under = (pad: Pad) => pad.x > body.minX && pad.x < body.maxX && pad.y > body.minY && pad.y < body.maxY
  return input.pads.filter((pad) => !under(pad))
}

/** The body: the footprint's body outline when it has one, never over the pads' inner ends; else what the pads enclose. */
export function bodyRect(input: ShapeInput, inset = 0.02): Rect {
  const sides = legPads(input).map((pad) => ({ pad, side: padSide(pad), r: padRect(pad) }))
  const inner = (side: Side) => sides.filter((s) => s.side === side)
  const all = padsRect(legPads(input)) ?? input.limit
  const reach = (side: Side, fallback: number) => {
    const row = inner(side)
    if (row.length === 0) return fallback
    if (side === "right") return Math.min(...row.map((s) => s.r.minX)) - inset
    if (side === "left") return Math.max(...row.map((s) => s.r.maxX)) + inset
    if (side === "top") return Math.min(...row.map((s) => s.r.minY)) - inset
    return Math.max(...row.map((s) => s.r.maxY)) + inset
  }
  const spare = 0.45
  const estimate: Rect = {
    minX: reach("left", all.minX - spare),
    maxX: reach("right", all.maxX + spare),
    minY: reach("bottom", all.minY - spare),
    maxY: reach("top", all.maxY + spare),
  }
  // With no pads on a side, the body runs a little past the last pad of the rows beside it.
  const rowless: Rect = {
    minX: inner("left").length === 0 ? Math.max(estimate.minX, all.minX - spare) : estimate.minX,
    maxX: inner("right").length === 0 ? Math.min(estimate.maxX, all.maxX + spare) : estimate.maxX,
    minY: inner("bottom").length === 0 ? Math.max(estimate.minY, all.minY - spare) : estimate.minY,
    maxY: inner("top").length === 0 ? Math.min(estimate.maxY, all.maxY + spare) : estimate.maxY,
  }
  const outline = input.body ? clipped(input.body, rowless) : rowless
  return clipped(outline, input.limit)
}

/** One leg: from the body's edge out to the pad, as three boxes in the pad's direction; `across` sets its width when given. */
export function leg(pad: Pad, side: Side, body: Rect, height: number, color: readonly [number, number, number], across?: number): Piece[] {
  const r = padRect(pad)
  const horizontal = side === "left" || side === "right"
  const sign = side === "right" || side === "top" ? 1 : -1
  const edge = side === "right" ? body.maxX : side === "left" ? body.minX : side === "top" ? body.maxY : body.minY
  const centre = horizontal ? pad.x : pad.y
  const length = horizontal ? r.maxX - r.minX : r.maxY - r.minY
  const padAcross = horizontal ? r.maxY - r.minY : r.maxX - r.minX
  const width = across ?? Math.min(padAcross * 0.72, 0.5)
  const mid = horizontal ? pad.y : pad.x
  const reach = sign * (centre - edge)
  if (reach <= 0.05) return []
  const bend = edge + sign * Math.min(reach * 0.38, 0.6)
  const toe = centre + sign * Math.min(length * 0.3, Math.abs(length / 2) - 0.02)
  // A strip is thinner than a third of a very low part, so the leg always fits between the board and the height.
  const lead = Math.min(LEAD, height / 3)
  const shoulder = Math.min(Math.max(height * 0.38, lead * 1.5), height - lead * 1.5, SHOULDER_MOST)
  const span = (a: number, b: number, z0: number, z1: number) => {
    const [lo, hi] = [Math.min(a, b), Math.max(a, b)]
    const rect: Rect = horizontal ? { minX: lo, maxX: hi, minY: mid - width / 2, maxY: mid + width / 2 } : { minY: lo, maxY: hi, minX: mid - width / 2, maxX: mid + width / 2 }
    return box(rect, z0, z1, color, "metal", "leg")
  }
  return [...span(edge, bend + sign * lead, shoulder, shoulder + lead), ...span(bend, bend + sign * lead, lead, shoulder), ...span(bend, toe, 0, lead)]
}

/** The pin 1 dot in the corner of `body`'s top (at `top`) that pad 1 lies towards; `roomy` (mm) caps how far in from the edges it stands. */
export function pin1Dot(input: ShapeInput, body: Rect, top: number, roomy = Infinity): Piece[] {
  const one = firstPad(input.pads)
  if (one === undefined) return []
  const small = Math.min(body.maxX - body.minX, body.maxY - body.minY)
  const radius = Math.min(small * 0.12, 0.4)
  const inset = radius + Math.min(small * 0.08, roomy)
  const x = one.x < (body.minX + body.maxX) / 2 ? body.minX + inset : body.maxX - inset
  const y = one.y < (body.minY + body.maxY) / 2 ? body.minY + inset : body.maxY - inset
  return prism(circle(x, y, radius, 12), top - 0.01, input.height, input.look.mark, "matt", "pin1")
}

export function gullwingShape(input: ShapeInput): Piece[] {
  const body = bodyRect(input)
  const h = input.height
  const { bottom, top } = bodyBand(h)
  const { look } = input
  const pieces: Piece[] = [...box(body, bottom, top, look.body, "matt", "body")]
  const legged = legPads(input)
  for (const pad of legged) pieces.push(...leg(pad, padSide(pad), body, h, look.metal))
  // An exposed pad shows as a thin tinned plate under the body, with no leg.
  for (const pad of input.pads.filter((one) => !legged.includes(one))) pieces.push(...box(clipped(padRect(pad), body), 0, Math.min(PLATE, bottom), look.metal, "metal", "cap"))
  pieces.push(...pin1Dot(input, body, top))
  return clipPieces(pieces, input.limit)
}
