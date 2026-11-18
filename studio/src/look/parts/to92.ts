// A TO-92: a D-shaped dark body (a flat face at the front, a round back) standing on three leads, raised off the
// board, with a smaller D on top for the rounded shoulder. The footprint's body outline gives its size. Pure.
import { leads, type ShapeInput } from "./input.js"
import { box, clipped, grown, prism, type Flat, type Piece, type Rect } from "./kit.js"

/** The body stands this far off the board at most, or this share of the part's height. */
const STANDOFF = 0.7
const STANDOFF_SHARE = 0.2
/** The shoulder: the top D is this much smaller on every side, and this tall. */
const SHOULDER = 0.35
const SHOULDER_HEIGHT = 0.6
const ARC_STEPS = 14
/** A lead's half width and half thickness. */
const LEAD_HALF = { x: 0.22, y: 0.2 }

/**
 * The D of a rectangle: a round back (as wide as the rectangle) on its far side (+y), the near edge as the flat front.
 * A body deeper than twice its radius keeps straight sides down to the front.
 */
export function dShape(r: Rect): Flat[] {
  const radius = (r.maxX - r.minX) / 2
  const [cx, cy] = [(r.minX + r.maxX) / 2, r.maxY - radius]
  const point = (angle: number): Flat => ({ x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
  if (r.minY < cy - radius) {
    const back = Array.from({ length: ARC_STEPS + 1 }, (_, i) => point((Math.PI * i) / ARC_STEPS))
    return [...back, { x: cx - radius, y: r.minY }, { x: cx + radius, y: r.minY }]
  }
  const start = Math.asin(Math.max(-1, Math.min(1, (r.minY - cy) / radius)))
  const sweep = Math.PI - 2 * start
  const closed = sweep >= 2 * Math.PI - 1e-9
  return Array.from({ length: closed ? ARC_STEPS : ARC_STEPS + 1 }, (_, i) => point(start + (sweep * i) / ARC_STEPS))
}

export function to92Shape(input: ShapeInput): Piece[] {
  const outline: Rect = clipped(input.body ?? grown(input.limit, -0.2), input.limit)
  const { look } = input
  const h = input.height
  const foot = Math.min(STANDOFF, h * STANDOFF_SHARE)
  const shoulder = Math.max(foot + 0.1, h - SHOULDER_HEIGHT)
  const pieces: Piece[] = [
    ...prism(dShape(outline), foot, shoulder, look.body, "matt", "body"),
    ...prism(dShape(grown(outline, -SHOULDER)), shoulder, h, look.body, "matt", "body"),
  ]
  for (const pad of input.pads) {
    const strip = { minX: pad.x - LEAD_HALF.x, maxX: pad.x + LEAD_HALF.x, minY: pad.y - LEAD_HALF.y, maxY: pad.y + LEAD_HALF.y }
    pieces.push(...box(strip, 0, foot + 0.3, look.metal, "metal", "leg"))
  }
  return [...pieces, ...leads(input, look.metal, LEAD_HALF)]
}
