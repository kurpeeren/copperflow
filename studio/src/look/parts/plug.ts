// A pluggable terminal header lying flat (male, 90 degrees), drawn from its library footprint: a solid back over the
// row of holes, and in front of it a shroud open at the front, its floor, roof and end walls with a rib between every
// two poles and a pin lying in each pole, pointing out of the front. The front is the side the body outline reaches
// further from the holes. A lead goes through each hole. Pure.
import { leads, type ShapeInput } from "./input.js"
import { box, clipped, grown, type Piece, type Rect } from "./kit.js"
import type { Rgb } from "../scene.js"

/** The outline must reach this much further on one side of the holes than the other for a front to be read. */
const FRONT_MARGIN = 2
/** Pitches below this are pin rows, drawn as plain blocks. */
const MIN_PITCH = 3.5
/** The back reaches this share of the way from the holes to the front, at least past the pads. */
const BACK_SHARE = 0.3
/** Wall, floor and roof thickness; a rib's half width and how far it stands back from the front. */
const WALL = 0.9
const RIB_HALF = 0.4
const RIB_BACK = 0.6
/** A lying pin: its half size, and how far its tip stands back from the front. */
const PIN_HALF = 0.5
const PIN_BACK = 1.2
const INSET = 0.15
const SHADOW = 0.55

const darker = (color: Rgb, share: number): Rgb => color.map((c) => Math.round(c * share)) as unknown as Rgb

/** The holes' common y, when they form one row along x at a pitch of a terminal; else undefined. */
export function plugRow(input: ShapeInput): { y: number; xs: number[]; pitch: number } | undefined {
  const holes = input.pads.filter((pad) => pad.layers === "through")
  if (holes.length < 2 || holes.length !== input.pads.length) return undefined
  const y = holes[0]?.y as number
  if (holes.some((pad) => Math.abs(pad.y - y) > 1e-3)) return undefined
  const xs = holes.map((pad) => pad.x).sort((a, b) => a - b)
  const pitch = Math.min(...xs.slice(1).map((x, i) => x - (xs[i] as number)))
  return pitch >= MIN_PITCH ? { y, xs, pitch } : undefined
}

/** Which way the front faces (+1 toward +y, -1 toward -y), when the outline reaches clearly further one way. */
export function plugFront(outline: Rect, rowY: number): 1 | -1 | undefined {
  const [ahead, behind] = [outline.maxY - rowY, rowY - outline.minY]
  if (ahead - behind >= FRONT_MARGIN) return 1
  if (behind - ahead >= FRONT_MARGIN) return -1
  return undefined
}

/** A rectangle between two distances from the row along the front's direction, and two x. */
const band = (x0: number, x1: number, rowY: number, front: 1 | -1, u0: number, u1: number): Rect => {
  const [a, b] = [rowY + front * u0, rowY + front * u1]
  return { minX: x0, maxX: x1, minY: Math.min(a, b), maxY: Math.max(a, b) }
}

/** The shape, or undefined when the footprint is not one row with a front (the caller draws a plain block). */
export function plugShape(input: ShapeInput): Piece[] | undefined {
  const row = plugRow(input)
  if (row === undefined) return undefined
  const outline: Rect = clipped(input.body ?? grown(input.limit, -INSET), input.limit)
  const front = plugFront(outline, row.y)
  if (front === undefined) return undefined
  const { look } = input
  const h = input.height
  const reach = front === 1 ? outline.maxY - row.y : row.y - outline.minY
  const behind = front === 1 ? row.y - outline.minY : outline.maxY - row.y
  const padReach = Math.max(...input.pads.map((pad) => Math.max(pad.width, pad.height) / 2))
  const backEnd = Math.min(reach - WALL * 2, Math.max(reach * BACK_SHARE, padReach + 0.3))
  const inside = darker(look.body, SHADOW)
  const [x0, x1] = [outline.minX, outline.maxX]
  // The back's face inside the shroud, facing the front, is in shadow.
  const back = box(band(x0, x1, row.y, front, -behind, backEnd), 0, h, look.body, "matt", "body").map((piece) => (piece.normal[1] === front ? { ...piece, color: inside } : piece))
  const shroud = [
    ...box(band(x0, x1, row.y, front, backEnd, reach), 0, WALL, look.body, "matt", "body"),
    ...box(band(x0, x1, row.y, front, backEnd, reach), h - WALL, h, look.body, "matt", "body"),
    ...box(band(x0, x0 + WALL, row.y, front, backEnd, reach), WALL, h - WALL, look.body, "matt", "body"),
    ...box(band(x1 - WALL, x1, row.y, front, backEnd, reach), WALL, h - WALL, look.body, "matt", "body"),
  ]
  const ribs = row.xs.slice(1).flatMap((x, i) => {
    const mid = (x + (row.xs[i] as number)) / 2
    return box(band(mid - RIB_HALF, mid + RIB_HALF, row.y, front, backEnd, reach - RIB_BACK), WALL, h - WALL, look.body, "matt", "body")
  })
  const pinZ = h / 2
  const pins = row.xs.flatMap((x) => box(band(x - PIN_HALF, x + PIN_HALF, row.y, front, backEnd, reach - PIN_BACK), pinZ - PIN_HALF, pinZ + PIN_HALF, look.metal, "metal", "lead"))
  return [...back, ...shroud, ...ribs, ...pins, ...leads(input)]
}
