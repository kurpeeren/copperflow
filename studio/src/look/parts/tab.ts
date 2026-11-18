// A power SOT with a tab (SOT-223, SOT-89): a dark body with a pin 1 dot, gull-wing legs on its narrow pads and one wide
// flat tab, as wide as its pad, from the body's far side down to that pad. The legs are the gull-wing family's. Pure.
import type { Pad } from "../../../../src/engine/footprints/types.js"
import { clipPieces } from "./chip.js"
import { bodyBand, bodyRect, leg, padSide, pin1Dot } from "./gullwing.js"
import { padRect, type ShapeInput } from "./input.js"
import { box, clipped, rectOf, type Flat, type Piece, type Rect } from "./kit.js"

/** A tab pad shorter than this outside the body gets no riser (its foot is all there is). */
const MIN_REACH = 0.15
const FOOT = 0.15

type Side = "left" | "right" | "top" | "bottom"

const area = (pad: Pad) => pad.width * pad.height

/** The side of the body the tab leaves from: where the pad lies, as a share of the body's half sizes. */
function tabSide(pad: Pad, body: Rect): Side {
  const [cx, cy] = [(body.minX + body.maxX) / 2, (body.minY + body.maxY) / 2]
  const [dx, dy] = [(pad.x - cx) / ((body.maxX - body.minX) / 2), (pad.y - cy) / ((body.maxY - body.minY) / 2)]
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? "top" : "bottom"
  return dx >= 0 ? "right" : "left"
}

/** The tab: a foot over the whole pad, and a riser to the body from the part of the pad that lies outside it. */
function tab(pad: Pad, body: Rect, height: number, color: ShapeInput["look"]["metal"]): Piece[] {
  const r = padRect(pad)
  const side = tabSide(pad, body)
  const vertical = side === "top" || side === "bottom"
  const across = vertical ? r.maxX - r.minX : r.maxY - r.minY
  const outside: Rect = {
    minX: side === "right" ? Math.max(r.minX, body.maxX) : r.minX,
    maxX: side === "left" ? Math.min(r.maxX, body.minX) : r.maxX,
    minY: side === "top" ? Math.max(r.minY, body.maxY) : r.minY,
    maxY: side === "bottom" ? Math.min(r.maxY, body.minY) : r.maxY,
  }
  const reach = vertical ? outside.maxY - outside.minY : outside.maxX - outside.minX
  if (reach < MIN_REACH) return box(r, 0, Math.min(FOOT, height / 3), color, "metal", "leg")
  const outer: Pad = { ...pad, x: (outside.minX + outside.maxX) / 2, y: (outside.minY + outside.maxY) / 2, width: outside.maxX - outside.minX, height: outside.maxY - outside.minY, rotation: 0 }
  return leg(outer, side, body, height, color, across)
}

export function tabShape(input: ShapeInput): Piece[] {
  const wide = input.pads.reduce<Pad | undefined>((best, pad) => (best === undefined || area(pad) > area(best) ? pad : best), undefined)
  const narrow = input.pads.filter((pad) => pad !== wide)
  // A DPAK's fabrication lines are the body and, separately, the tab's outline: the body is the first.
  const outline = input.outlines !== undefined && input.outlines.length > 1 ? rectOf(input.outlines[0] as readonly Flat[]) : input.body
  const body = outline ? clipped(outline, input.limit) : bodyRect({ ...input, pads: narrow })
  const h = input.height
  const { bottom, top } = bodyBand(h)
  const { look } = input
  const pieces: Piece[] = [...box(body, bottom, top, look.body, "matt", "body")]
  for (const pad of narrow) pieces.push(...leg(pad, padSide(pad), body, h, look.metal))
  if (wide !== undefined) pieces.push(...tab(wide, body, h, look.metal))
  pieces.push(...pin1Dot(input, body, top))
  return clipPieces(pieces, input.limit)
}
