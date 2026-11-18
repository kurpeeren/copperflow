// What the surface-mount families share: the axis of a two-pad part, a terminal wrapped over the edge of a body above a
// pad, a J-lead (a riser down the body's side and a foot tucked under), and a polygon with one corner clipped. Pure.
import type { Pad } from "../../../../src/engine/footprints/types.js"
import type { Rgb, Role } from "../scene.js"
import { clipPieces } from "./chip.js"
import { padRect, type ShapeInput } from "./input.js"
import { box, clipped, turnPieces, type Flat, type Piece, type Rect } from "./kit.js"

export type Side = "left" | "right" | "top" | "bottom"

/** Where two pads put a part: its axis turned from +x, its middle, and the sizes along and across that axis. */
export interface TwoPads {
  angle: number
  mid: Flat
  gap: number
  padAlong: number
  padAcross: number
  bodyAlong: number
  bodyAcross: number
}

/** The axis from pad 1 to pad 2 and the sizes along it; the body's from its outline when there is one. */
export function twoPads(input: ShapeInput): TwoPads | undefined {
  const [one, two] = [input.pads.find((pad) => pad.number === "1") ?? input.pads[0], input.pads.find((pad) => pad.number === "2") ?? input.pads[1]]
  if (one === undefined || two === undefined) return undefined
  const angle = (Math.atan2(two.y - one.y, two.x - one.x) * 180) / Math.PI
  const flat = Math.abs(Math.sin((angle * Math.PI) / 180)) > 0.7
  const rect = padRect(two)
  const gap = Math.hypot(two.x - one.x, two.y - one.y)
  const padAlong = flat ? rect.maxY - rect.minY : rect.maxX - rect.minX
  const padAcross = flat ? rect.maxX - rect.minX : rect.maxY - rect.minY
  const bodyAlong = input.body ? (flat ? input.body.maxY - input.body.minY : input.body.maxX - input.body.minX) : gap + padAlong * 0.3
  const bodyAcross = input.body ? (flat ? input.body.maxX - input.body.minX : input.body.maxY - input.body.minY) : padAcross
  return { angle, mid: { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2 }, gap, padAlong, padAcross, bodyAlong, bodyAcross }
}

/** Pieces made along x about the origin, turned to the axis, moved to the pads' middle and kept inside the courtyard. */
export function settle(pieces: readonly Piece[], axis: TwoPads, input: ShapeInput): Piece[] {
  const moved = turnPieces(pieces, axis.angle).map((piece) => ({ ...piece, loops: piece.loops.map((loop) => loop.map((p): [number, number, number] => [p[0] + axis.mid.x, p[1] + axis.mid.y, p[2]])) }))
  return clipPieces(moved, input.limit)
}

/** The side of `body` a pad lies out of: the way it is furthest in the body's own half sizes. */
export function sideOf(pad: Pad, body: Rect): Side {
  const [dx, dy] = [(pad.x - (body.minX + body.maxX) / 2) / ((body.maxX - body.minX) / 2 || 1), (pad.y - (body.minY + body.maxY) / 2) / ((body.maxY - body.minY) / 2 || 1)]
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? "top" : "bottom"
  return dx >= 0 ? "right" : "left"
}

/** The part of a pad that lies within `inside` of the body's edge on `side`, or `outside` beyond it. */
function band(pad: Pad, body: Rect, side: Side, inside: number, outside: number): Rect {
  const grownBody = { minX: body.minX - outside, maxX: body.maxX + outside, minY: body.minY - outside, maxY: body.maxY + outside }
  const strip: Rect = {
    left: { ...grownBody, minX: body.minX - outside, maxX: body.minX + inside },
    right: { ...grownBody, minX: body.maxX - inside, maxX: body.maxX + outside },
    bottom: { ...grownBody, minY: body.minY - outside, maxY: body.minY + inside },
    top: { ...grownBody, minY: body.maxY - inside, maxY: body.maxY + outside },
  }[side]
  return clipped(padRect(pad), strip)
}

export interface TerminalSpec {
  /** How far the terminal reaches in under the body from its edge, and out beyond it. */
  inside: number
  outside: number
  height: number
  /** The most across, centred on the pad, when the terminal is narrower than the pad. */
  across?: number
  role?: Role
}

/** A metal terminal on a pad: the part of the pad at the body's edge, standing `height` high. It lies inside the pad. */
export function terminal(pad: Pad, body: Rect, spec: TerminalSpec, color: Rgb): Piece[] {
  const side = sideOf(pad, body)
  const region = band(pad, body, side, spec.inside, spec.outside)
  const narrow = spec.across === undefined ? region : narrowed(region, side, spec.across)
  return box(narrow.maxX > narrow.minX && narrow.maxY > narrow.minY ? narrow : padRect(pad), 0, spec.height, color, "metal", spec.role ?? "cap")
}

/** `r` kept within `across` of its middle on the axis that runs along the body's edge. */
function narrowed(r: Rect, side: Side, across: number): Rect {
  const vertical = side === "left" || side === "right"
  const [mid, size] = vertical ? [(r.minY + r.maxY) / 2, r.maxY - r.minY] : [(r.minX + r.maxX) / 2, r.maxX - r.minX]
  const half = Math.min(size, across) / 2
  return vertical ? { ...r, minY: mid - half, maxY: mid + half } : { ...r, minX: mid - half, maxX: mid + half }
}

export interface JLeadSpec {
  /** How far the lead's outer face stands off the body's side, at most; the pad's own end less `toe` otherwise. */
  reach: number
  toe: number
  /** The strip's thickness, the height its stub leaves the body at, and how far its foot tucks in under the body. */
  thick: number
  rise: number
  tuck: number
  /** Width across, at most. */
  across: number
}

/** A J-lead: a stub out of the body's side at `rise`, a riser down to the board and a foot tucked under the body. */
export function jLead(pad: Pad, side: Side, body: Rect, spec: JLeadSpec, color: Rgb): Piece[] {
  const r = padRect(pad)
  const vertical = side === "left" || side === "right"
  const sign = side === "right" || side === "top" ? 1 : -1
  const edge = side === "right" ? body.maxX : side === "left" ? body.minX : side === "top" ? body.maxY : body.minY
  const [near, far, across, mid] = vertical ? [r.minX, r.maxX, r.maxY - r.minY, pad.y] : [r.minY, r.maxY, r.maxX - r.minX, pad.x]
  const padOut = sign > 0 ? far - edge : edge - near
  const padIn = sign > 0 ? near - edge : edge - far
  const outer = Math.min(spec.reach, padOut - spec.toe)
  if (outer < spec.thick) return []
  const half = Math.min(across, spec.across) / 2
  const strip = (a: number, b: number, z0: number, z1: number): Piece[] => {
    const [lo, hi] = [Math.min(edge + sign * a, edge + sign * b), Math.max(edge + sign * a, edge + sign * b)]
    const rect: Rect = vertical ? { minX: lo, maxX: hi, minY: mid - half, maxY: mid + half } : { minY: lo, maxY: hi, minX: mid - half, maxX: mid + half }
    return box(rect, z0, z1, color, "metal", "leg")
  }
  const foot = spec.thick
  return [...strip(Math.max(-spec.tuck, padIn), outer, 0, foot), ...strip(outer - spec.thick, outer, foot, spec.rise - foot), ...strip(0, outer, spec.rise - foot, spec.rise)]
}

/** A rectangle's outline counter-clockwise with one corner (`sx`, `sy` = ±1 for its side) cut off by `cut`. */
export function clippedCorner(r: Rect, sx: number, sy: number, cut: number): Flat[] {
  const corners: { x: number; y: number; sx: number; sy: number }[] = [
    { x: r.minX, y: r.minY, sx: -1, sy: -1 },
    { x: r.maxX, y: r.minY, sx: 1, sy: -1 },
    { x: r.maxX, y: r.maxY, sx: 1, sy: 1 },
    { x: r.minX, y: r.maxY, sx: -1, sy: 1 },
  ]
  return corners.flatMap((c, i): Flat[] => {
    if (c.sx !== sx || c.sy !== sy) return [{ x: c.x, y: c.y }]
    const [before, after] = [corners[(i + 3) % 4]!, corners[(i + 1) % 4]!]
    const toward = (to: { x: number; y: number }): Flat => ({ x: c.x + Math.sign(to.x - c.x) * cut, y: c.y + Math.sign(to.y - c.y) * cut })
    return [toward(before), toward(after)]
  })
}
