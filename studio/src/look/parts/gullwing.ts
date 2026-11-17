// A gull-wing chip (SOIC, SOT, TSSOP, QFP): a dark moulded body with a pin 1 dot, and a metal leg from each side of
// the body out over its pad: a shoulder from the body, a bend down, and a foot on the pad. Pure.
import type { Pad } from "../../../../src/engine/footprints/types.js"
import { clipPieces } from "./chip.js"
import { box, circle, clipped, prism, type Piece, type Rect } from "./kit.js"
import { firstPad, padRect, padsRect, type ShapeInput } from "./input.js"

/** Lead thickness, mm. */
const LEAD = 0.15
/** The body stands this far off the board. */
const STANDOFF = 0.08

type Side = "left" | "right" | "bottom" | "top"

/** The side of the body a pad's leg leaves from: along the pad's long side, away from the centre. */
export function padSide(pad: Pad): Side {
  const r = padRect(pad)
  const wide = r.maxX - r.minX >= r.maxY - r.minY
  if (wide) return pad.x >= 0 ? "right" : "left"
  return pad.y >= 0 ? "top" : "bottom"
}

/** The body: the footprint's body outline when it has one, never over the pads' inner ends; else what the pads enclose. */
export function bodyRect(input: ShapeInput, inset = 0.02): Rect {
  const sides = input.pads.map((pad) => ({ pad, side: padSide(pad), r: padRect(pad) }))
  const inner = (side: Side) => sides.filter((s) => s.side === side)
  const all = padsRect(input.pads) ?? input.limit
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
    minX: reach("left", all.minX - (inner("top").length + inner("bottom").length > 0 ? 0 : 0) + (inner("left").length === 0 && inner("right").length === 0 ? 0 : 0) - spare),
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

/** One leg: from the body's edge out to the pad, as three boxes in the pad's direction. */
function leg(pad: Pad, side: Side, body: Rect, height: number, color: readonly [number, number, number]): Piece[] {
  const r = padRect(pad)
  const horizontal = side === "left" || side === "right"
  const sign = side === "right" || side === "top" ? 1 : -1
  const edge = side === "right" ? body.maxX : side === "left" ? body.minX : side === "top" ? body.maxY : body.minY
  const centre = horizontal ? pad.x : pad.y
  const length = horizontal ? r.maxX - r.minX : r.maxY - r.minY
  const across = horizontal ? r.maxY - r.minY : r.maxX - r.minX
  const width = Math.min(across * 0.72, 0.5)
  const mid = horizontal ? pad.y : pad.x
  const reach = sign * (centre - edge)
  if (reach <= 0.05) return []
  const bend = edge + sign * Math.min(reach * 0.38, 0.6)
  const toe = centre + sign * Math.min(length * 0.3, Math.abs(length / 2) - 0.02)
  const shoulder = Math.min(Math.max(height * 0.38, LEAD * 1.5), height - LEAD * 1.5)
  const span = (a: number, b: number, z0: number, z1: number) => {
    const [lo, hi] = [Math.min(a, b), Math.max(a, b)]
    const rect: Rect = horizontal ? { minX: lo, maxX: hi, minY: mid - width / 2, maxY: mid + width / 2 } : { minY: lo, maxY: hi, minX: mid - width / 2, maxX: mid + width / 2 }
    return box(rect, z0, z1, color, "metal", "leg")
  }
  return [...span(edge, bend + sign * LEAD, shoulder, shoulder + LEAD), ...span(bend, bend + sign * LEAD, LEAD, shoulder), ...span(bend, toe, 0, LEAD)]
}

export function gullwingShape(input: ShapeInput): Piece[] {
  const body = bodyRect(input)
  const h = input.height
  const top = h - 0.02
  const { look } = input
  const pieces: Piece[] = [...box(body, STANDOFF, top, look.body, "matt", "body")]
  for (const pad of input.pads) pieces.push(...leg(pad, padSide(pad), body, h, look.metal))
  const one = firstPad(input.pads)
  if (one !== undefined) {
    const small = Math.min(body.maxX - body.minX, body.maxY - body.minY)
    const radius = Math.min(small * 0.12, 0.4)
    const inset = radius + small * 0.08
    const x = one.x < (body.minX + body.maxX) / 2 ? body.minX + inset : body.maxX - inset
    const y = one.y < (body.minY + body.maxY) / 2 ? body.minY + inset : body.maxY - inset
    pieces.push(...prism(circle(x, y, radius, 12), top - 0.01, h, look.mark, "matt", "pin1"))
  }
  return clipPieces(pieces, input.limit)
}
