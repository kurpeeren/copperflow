// A surface-mount aluminium can: a black plastic base (the footprint's body outline, two corners clipped on the plus
// side) under an aluminium can with a rounded top edge, a dark segment on the lid at the minus side (pad 2) and a
// J-lead from the base's side to each pad; its value and voltage are printed on the lid beside the segment. Pure.
import { clipPieces } from "./chip.js"
import { padsRect, type ShapeInput } from "./input.js"
import { clipped, grown, lathe, prism, rectOf, type Flat, type Piece, type Rect } from "./kit.js"
import { jLead, sideOf } from "./smd.js"
import { lidPrint, printedLines } from "./sleeve-print.js"

/** The base stands this far off the board (the lead's thickness), and is this share of the height, between these limits, mm. */
const STANDOFF = 0.12
const BASE_SHARE = 0.15
const BASE_LEAST = 0.8
const BASE_MOST = 1.2
/** On a very low part the base is at most this share of the height. */
const BASE_CEILING = 0.4
/** The can's top edge is rounded over this radius; the lid sits this far below the part's top, the segment's edge. */
const ROUND = 0.35
const ROUND_STEPS = 3
const LID_DROP = 0.02
const SIDES = 28
/** The dark segment is the part of the lid beyond this share of its radius, and a little smaller than the lid. */
const SEGMENT_FROM = 0.45
const SEGMENT_SHARE = 0.92
/** A lead's strip, the height its stub leaves the base at (share of the base), its reach and tuck, mm. */
const STRIP = 0.12
const REACH = 0.6
const TUCK = 0.8

/** The base outline: the footprint's first fabrication line without its closing point, else the rectangle. */
function baseOutline(input: ShapeInput, body: Rect): readonly Flat[] {
  const first = input.outlines?.[0]
  if (first === undefined || first.length < 4) return [{ x: body.minX, y: body.minY }, { x: body.maxX, y: body.minY }, { x: body.maxX, y: body.maxY }, { x: body.minX, y: body.maxY }]
  const [a, z] = [first[0] as Flat, first[first.length - 1] as Flat]
  return a.x === z.x && a.y === z.y ? first.slice(0, -1) : first
}

/** The can's radius: the footprint's circle when it has one, else a little inside the base. */
function canRadius(input: ShapeInput, body: Rect): number {
  const circle = input.outlines?.find((line, i) => i > 0 && line.length > 16)
  const found = circle === undefined ? undefined : rectOf(circle)
  return found === undefined ? Math.min(body.maxX - body.minX, body.maxY - body.minY) / 2 - 0.15 : (found.maxX - found.minX) / 2
}

/** The part of the lid disc beyond x = `from`, a little smaller than the disc, counter-clockwise. */
function segment(radius: number, from: number): Flat[] {
  const reach = Math.acos(Math.min(1, from / radius))
  const arc = Array.from({ length: 9 }, (_, i): Flat => ({ x: radius * Math.cos(-reach + (2 * reach * i) / 8), y: radius * Math.sin(-reach + (2 * reach * i) / 8) }))
  return arc
}

export function smdCanShape(input: ShapeInput): Piece[] {
  const body = clipped(input.body ?? grown(padsRect(input.pads) ?? input.limit, -0.1), input.limit)
  const h = input.height
  const { look } = input
  const baseTop = Math.min(BASE_MOST, Math.max(BASE_LEAST, h * BASE_SHARE), h * BASE_CEILING)
  const standoff = Math.min(STANDOFF, baseTop / 3)
  const radius = canRadius(input, body)
  const lidZ = h - Math.min(LID_DROP, h * 0.1)
  const round = Math.min(ROUND, (lidZ - baseTop) / 2, radius / 2)
  const lidRadius = radius - round
  const edge = Array.from({ length: ROUND_STEPS + 1 }, (_, i): [number, number] => {
    const angle = (Math.PI / 2) * (i / ROUND_STEPS)
    return [lidRadius + round * Math.cos(angle), lidZ - round + round * Math.sin(angle)]
  })
  const profile: [number, number][] = [[radius, baseTop], ...edge]
  const dark = segment(lidRadius * SEGMENT_SHARE, lidRadius * SEGMENT_SHARE * SEGMENT_FROM)
  const pieces: Piece[] = [
    ...prism(baseOutline(input, body), standoff, baseTop, look.body, "matt", "body"),
    ...lathe(profile, 0, 0, SIDES, { top: look.top ?? look.metal, side: look.metal }, "metal", "body"),
    ...prism(dark, lidZ, h, look.mark, "matt", "cathode"),
    // The value and voltage, in the lid's plain part beside the segment.
    ...lidPrint({ x: (-lidRadius + lidRadius * SEGMENT_FROM * SEGMENT_SHARE) / 2, y: 0 }, lidRadius * 1.3, lidRadius * (1 + SEGMENT_FROM * SEGMENT_SHARE) * 0.8, lidZ, printedLines(input.props), look.mark),
  ]
  const strip = Math.min(STRIP, standoff)
  const rise = (standoff + baseTop) / 2 + strip / 2
  for (const pad of input.pads) pieces.push(...jLead(pad, sideOf(pad, body), body, { reach: REACH, toe: 0.1, thick: strip, rise, tuck: TUCK, across: 1.4 }, look.metal))
  return clipPieces(pieces, input.limit)
}
