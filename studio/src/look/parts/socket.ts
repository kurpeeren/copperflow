// A pin socket (female header) at 2.54 mm: a black body along its pads as tall as the part, a dark square opening sunk
// into the top over every pin, a gold pin through each hole. The top is cut round each opening into four strips, so the
// opening is really a recess (four dark walls and a darker floor), with no face laid over another. Pure.
import { clipped, facet, prism, rectPolygon, type Piece, type Rect } from "./kit.js"
import { leads, padsRect, type ShapeInput } from "./input.js"

const PITCH = 2.54
/** An opening's half side and how deep it is at most (and the share of the height it may take). */
const OPENING_HALF = 0.75
const OPENING_DEPTH = 1.2
const DEPTH_SHARE = 0.3
/** The recess's walls are a touch lighter than its floor so that they read. */
const WALL_LIFT = 6

type Corner = readonly [number, number]

/** A flat rectangle at height `z` facing up. */
const lid = (a: Corner, b: Corner, z: number, color: ShapeInput["look"]["body"]): Piece =>
  facet([[a[0], a[1], z], [b[0], a[1], z], [b[0], b[1], z], [a[0], b[1], z]], [0, 0, 1], color, "matt", "body")

/** One pin's cell: the top round the opening in four strips, the opening's four walls, and its floor. */
function cell(x: number, y: number, h: number, depth: number, input: ShapeInput): Piece[] {
  const o = OPENING_HALF
  const { look } = input
  const r = clipped({ minX: x - PITCH / 2, maxX: x + PITCH / 2, minY: y - PITCH / 2, maxY: y + PITCH / 2 }, input.limit)
  const floor = h - depth
  const wallColor = look.mark.map((c) => c + WALL_LIFT) as unknown as typeof look.mark
  const wall = (from: Corner, to: Corner, outward: [number, number, number]): Piece =>
    facet([[from[0], from[1], floor], [to[0], to[1], floor], [to[0], to[1], h], [from[0], from[1], h]], outward, wallColor, "matt", "body")
  return [
    lid([r.minX, r.minY], [x - o, r.maxY], h, look.body),
    lid([x + o, r.minY], [r.maxX, r.maxY], h, look.body),
    lid([x - o, r.minY], [x + o, y - o], h, look.body),
    lid([x - o, y + o], [x + o, r.maxY], h, look.body),
    wall([x - o, y - o], [x + o, y - o], [0, 1, 0]),
    wall([x - o, y + o], [x + o, y + o], [0, -1, 0]),
    wall([x - o, y - o], [x - o, y + o], [1, 0, 0]),
    wall([x + o, y - o], [x + o, y + o], [-1, 0, 0]),
    lid([x - o, y - o], [x + o, y + o], floor, look.mark),
  ]
}

export function socketShape(input: ShapeInput): Piece[] {
  const pads = padsRect(input.pads)
  if (pads === undefined) return []
  const xs = input.pads.map((p) => p.x)
  const ys = input.pads.map((p) => p.y)
  const half = PITCH / 2
  const base: Rect = clipped({ minX: Math.min(...xs) - half, maxX: Math.max(...xs) + half, minY: Math.min(...ys) - half, maxY: Math.max(...ys) + half }, input.limit)
  const h = input.height
  const depth = Math.min(OPENING_DEPTH, h * DEPTH_SHARE)
  const sides = prism(rectPolygon(base), 0, h, input.look.body, "matt", "body").slice(1)
  const cells = input.pads.flatMap((pad) => cell(pad.x, pad.y, h, depth, input))
  return [...sides, ...cells, ...leads(input)]
}
