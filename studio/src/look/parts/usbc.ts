// A USB Type-C receptacle (16 pins): a low tinned metal shell, a stadium seen from the front, on the footprint's body
// outline, open at the mating face (−y) with a dark stadium opening ringed by the front and a thin pale tongue inside.
// Behind the shell a dark plastic block with the same rounded ends, a short tinned terminal on each signal pad, and a
// flat shell tab above each slot with a lead through it. Pure.
import { padRect, type ShapeInput } from "./input.js"
import { box, clipped, grown, stadium, type Piece } from "./kit.js"
import { capY, openBox, ringY, stripLeads, wallY } from "./uno-kit.js"

const STEPS = 8
/** The shell is no taller than this share of its length, so a part drawn very tall still has rounded ends that are not degenerate. */
const ROUND_LIMIT = 0.9
/** The shell wall's thickness at most and its share of the height; the rear block is this much smaller than the shell. */
const WALL = 0.35
const WALL_SHARE = 0.12
const REAR_INSET = 0.15
const REAR_INSET_SHARE = 0.1
/** The rear block's depth at most and its share of the body's depth. */
const REAR_DEPTH = 1.6
const REAR_SHARE = 0.22
/** The cavity's depth at most (it stops short of the rear block), the tongue's length and width, and its thickness (share of the opening's height). */
const CAVITY_DEPTH = 5
const CAVITY_STOP = 0.4
const TONGUE = { length: 4.6, shorter: 0.6, thick: 0.6 }
const TONGUE_THICK_SHARE = 0.28
/** A terminal's height at most and share of the part's height. */
const TERMINAL = 0.45
const TERMINAL_SHARE = 0.5
/** A shell tab goes up this high at most (share of the part's height), over the slot's lead strip. */
const TAB = 1.6
const TAB_SHARE = 0.5

export function usbCShape(input: ShapeInput): Piece[] {
  const body = clipped(input.body ?? grown(input.limit, -0.25), input.limit)
  const { look } = input
  const h = input.height
  const [mid, length] = [(body.minX + body.maxX) / 2, body.maxX - body.minX]
  const wall = Math.min(WALL, h * WALL_SHARE)
  const inset = Math.min(REAR_INSET, h * REAR_INSET_SHARE)
  const rear = body.maxY - Math.min(REAR_DEPTH, (body.maxY - body.minY) * REAR_SHARE)
  const back = Math.min(body.minY + CAVITY_DEPTH, rear - CAVITY_STOP)
  const tall = Math.min(h, length * ROUND_LIMIT)
  const outer = stadium(mid, h / 2, length, tall, STEPS)
  const opening = stadium(mid, h / 2, length - 2 * wall, tall - 2 * wall, STEPS)
  const block = stadium(mid, h / 2, length - 2 * inset, tall - 2 * inset, STEPS)
  const room = { minX: mid - Math.min(length / 2 - wall - 0.6, 3.4), maxX: mid + Math.min(length / 2 - wall - 0.6, 3.4) }
  const thick = (tall - 2 * wall) * TONGUE_THICK_SHARE
  const pieces: Piece[] = [
    ...wallY(outer, body.minY, rear, look.metal, "metal", "body"),
    capY(outer, rear, 1, look.metal, "metal", "body"),
    ...ringY(outer, opening, body.minY, -1, look.metal, "metal", "body"),
    ...wallY(opening, body.minY, back, look.mark, "matt", "body", "in"),
    capY(opening, back, -1, look.mark, "matt", "body"),
    ...openBox(room, back - Math.min(TONGUE.length, back - body.minY - TONGUE.shorter), back, (h - Math.min(TONGUE.thick, thick)) / 2, (h + Math.min(TONGUE.thick, thick)) / 2, look.body, "matt", "body"),
    ...wallY(block, rear, body.maxY, look.mark, "matt", "body"),
    capY(block, body.maxY, 1, look.mark, "matt", "body"),
  ]
  const through = (pad: { layers: string }) => pad.layers === "through"
  for (const pad of input.pads.filter((one) => !through(one))) pieces.push(...box(padRect(pad), 0, Math.min(TERMINAL, h * TERMINAL_SHARE), look.metal, "metal", "leg"))
  for (const pad of input.pads.filter(through)) {
    const half = { x: ((pad.drill?.width ?? 0.6) * 0.8) / 2, y: ((pad.drill?.height ?? 0.6) * 0.8) / 2 }
    pieces.push(...box(clipped({ minX: pad.x - half.x, maxX: pad.x + half.x, minY: pad.y - half.y, maxY: pad.y + half.y }, body), 0, Math.min(TAB, h * TAB_SHARE), look.metal, "metal", "leg"))
  }
  return [...pieces, ...stripLeads(input, through, look.metal)]
}
