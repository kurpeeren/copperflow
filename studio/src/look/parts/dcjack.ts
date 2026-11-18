// A barrel jack: a black plastic body on the footprint's body outline as tall as the part, a round opening in its mating
// face (−y) cut into a dark cavity with a metal pin standing in its middle, a flat terminal through every slot. The
// terminal that lies out at the body's side is also folded up against it. The front is one piece with a round hole. Pure.
import type { Vec3 } from "../scene.js"
import type { ShapeInput } from "./input.js"
import { box, circle, clipped, grown, prism, rectPolygon, type Piece } from "./kit.js"
import { capY, stripLeads, wallY } from "./uno-kit.js"

const SIDES = 16
const PIN_SIDES = 12
/** The opening's radius at most, its share of the body's width and of the height; the cavity's depth at most and share of the body's. */
const RADIUS = 3.2
const RADIUS_WIDTH_SHARE = 0.36
const RADIUS_HEIGHT_SHARE = 0.3
const CAVITY_DEPTH = 9
const DEPTH_SHARE = 0.62
/** The pin's radius as a share of the opening's, and its length at most and share of the cavity's depth. */
const PIN_SHARE = 0.31
const PIN_LENGTH = 6.5
const PIN_LENGTH_SHARE = 0.72
/** A side terminal's fold stands this high at most (share of the height). */
const FOLD = 3
const FOLD_SHARE = 0.3

/** The mating face: the body's outline with the round opening cut out of it, seen from −y. */
function face(x0: number, x1: number, y: number, h: number, cx: number, cz: number, radius: number, color: Piece["color"]): Piece {
  const ring = Array.from({ length: SIDES }, (_, i): Vec3 => [cx + radius * Math.cos((2 * Math.PI * i) / SIDES), y, cz + radius * Math.sin((2 * Math.PI * i) / SIDES)])
  return { loops: [[[x0, y, 0], [x1, y, 0], [x1, y, h], [x0, y, h]], [...ring].reverse()], normal: [0, -1, 0], color, material: "matt", role: "body" }
}

export function dcJackShape(input: ShapeInput): Piece[] {
  const body = clipped(input.body ?? grown(input.limit, -0.25), input.limit)
  const { look } = input
  const h = input.height
  const cx = (body.minX + body.maxX) / 2
  const radius = Math.min(RADIUS, (body.maxX - body.minX) * RADIUS_WIDTH_SHARE, h * RADIUS_HEIGHT_SHARE)
  const back = body.minY + Math.min(CAVITY_DEPTH, (body.maxY - body.minY) * DEPTH_SHARE)
  const opening = circle(cx, h / 2, radius, SIDES)
  const pin = circle(cx, h / 2, radius * PIN_SHARE, PIN_SIDES)
  const tip = back - Math.min(PIN_LENGTH, (back - body.minY) * PIN_LENGTH_SHARE)
  const sides = prism(rectPolygon(body), 0, h, look.body, "matt", "body").filter((piece) => piece.normal[1] > -0.99)
  const pieces: Piece[] = [
    ...sides,
    face(body.minX, body.maxX, body.minY, h, cx, h / 2, radius, look.body),
    ...wallY(opening, body.minY, back, look.mark, "matt", "body", "in"),
    capY(opening, back, -1, look.mark, "matt", "body"),
    ...wallY(pin, tip, back, look.metal, "metal", "pin"),
    capY(pin, tip, -1, look.metal, "metal", "pin"),
  ]
  for (const pad of input.pads) {
    const half = { x: ((pad.drill?.width ?? 0.6) * 0.8) / 2, y: ((pad.drill?.height ?? 0.6) * 0.8) / 2 }
    const [lo, hi] = [pad.x - half.x, pad.x + half.x]
    if (hi > body.maxX) pieces.push(...box({ minX: body.maxX, maxX: hi, minY: pad.y - half.y, maxY: pad.y + half.y }, 0, Math.min(FOLD, h * FOLD_SHARE), look.metal, "metal", "leg"))
    if (lo < body.minX) pieces.push(...box({ minX: lo, maxX: body.minX, minY: pad.y - half.y, maxY: pad.y + half.y }, 0, Math.min(FOLD, h * FOLD_SHARE), look.metal, "metal", "leg"))
  }
  return [...pieces, ...stripLeads(input, () => true, look.metal)]
}
