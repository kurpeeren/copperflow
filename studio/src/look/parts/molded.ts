// A diode or LED in a small moulded package (SOD-123, SMA, ...): a dark body between its pads, flat metal leads out to
// each pad and a light band across the top at the cathode, pad 2. Pure.
import { clipPieces } from "./chip.js"
import { box, turnPieces, type Piece, type Rect } from "./kit.js"
import { padRect, type ShapeInput } from "./input.js"

const LEAD = 0.12

export function moldedShape(input: ShapeInput): Piece[] {
  const one = input.pads.find((pad) => pad.number === "1") ?? input.pads[0]
  const two = input.pads.find((pad) => pad.number === "2") ?? input.pads[1]
  if (one === undefined || two === undefined) return []
  const angle = (Math.atan2(two.y - one.y, two.x - one.x) * 180) / Math.PI
  const mid = { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2 }
  const gap = Math.hypot(two.x - one.x, two.y - one.y)
  const r2 = padRect(two)
  const turnedFlat = Math.abs(Math.sin((angle * Math.PI) / 180)) > 0.7
  const padAcross = turnedFlat ? r2.maxX - r2.minX : r2.maxY - r2.minY
  const padAlong = turnedFlat ? r2.maxY - r2.minY : r2.maxX - r2.minX
  // The body: the outline's size when the footprint has one, else what lies between the pads.
  const bodyAlong = input.body ? (turnedFlat ? input.body.maxY - input.body.minY : input.body.maxX - input.body.minX) : gap - padAlong * 0.2
  const bodyAcross = input.body ? (turnedFlat ? input.body.maxX - input.body.minX : input.body.maxY - input.body.minY) : padAcross * 1.4
  const length = Math.min(bodyAlong, gap + padAlong * 0.6)
  const width = bodyAcross
  const h = input.height
  const top = h * 0.97
  const at = (minX: number, maxX: number, w: number): Rect => ({ minX, maxX, minY: -w / 2, maxY: w / 2 })
  const { look } = input
  const leadWidth = Math.min(padAcross * 0.6, width * 0.6)
  const band = Math.max(length * 0.16, 0.2)
  const pieces: Piece[] = [
    ...box(at(-gap / 2 - padAlong * 0.3, -length / 2 + 0.05, leadWidth), 0, LEAD, look.metal, "metal", "leg"),
    ...box(at(length / 2 - 0.05, gap / 2 + padAlong * 0.3, leadWidth), 0, LEAD, look.metal, "metal", "leg"),
    ...box(at(-length / 2, length / 2, width), 0.04, top, look.body, "matt", "body"),
    ...box(at(length / 2 - band * 1.9, length / 2 - band * 0.9, width * 0.96), top - 0.01, h, look.mark, "matt", "cathode"),
  ]
  const moved = turnPieces(pieces, angle).map((piece) => ({ ...piece, loops: piece.loops.map((loop) => loop.map((p): [number, number, number] => [p[0] + mid.x, p[1] + mid.y, p[2]])) }))
  return clipPieces(moved, input.limit)
}
