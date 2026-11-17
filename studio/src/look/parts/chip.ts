// A chip resistor, capacitor or LED (0402, 0603, 0805, ...): a body between two metal end caps, each cap over its pad.
// The resistor's top is its dark coat; the LED's is a pale lens with a green mark at the cathode (pad 2). Pure.
import { box, clipped, turnPieces, type Piece, type Rect } from "./kit.js"
import { padRect, type ShapeInput } from "./input.js"

/** The share of the body's length each end cap takes. */
const CAP_SHARE = 0.22

export function chipShape(input: ShapeInput): Piece[] {
  const [one, two] = [input.pads.find((pad) => pad.number === "1") ?? input.pads[0], input.pads.find((pad) => pad.number === "2") ?? input.pads[1]]
  if (one === undefined || two === undefined) return []
  const angle = (Math.atan2(two.y - one.y, two.x - one.x) * 180) / Math.PI
  const r = (-angle * Math.PI) / 180
  const along = (x: number, y: number) => x * Math.cos(r) - y * Math.sin(r)
  const across = (x: number, y: number) => x * Math.sin(r) + y * Math.cos(r)
  // Work along x from pad 1 to pad 2, about the pads' middle.
  const mid = { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2 }
  const gap = Math.hypot(two.x - one.x, two.y - one.y)
  const rect = padRect(two)
  const corners = [
    [rect.minX, rect.minY],
    [rect.maxX, rect.maxY],
    [rect.minX, rect.maxY],
    [rect.maxX, rect.minY],
  ].map(([x, y]) => ({ u: along((x as number) - mid.x, (y as number) - mid.y), v: across((x as number) - mid.x, (y as number) - mid.y) }))
  const padLength = Math.max(...corners.map((c) => c.u)) - Math.min(...corners.map((c) => c.u))
  const padWidth = Math.max(...corners.map((c) => c.v)) - Math.min(...corners.map((c) => c.v))
  const length = gap + padLength * 0.3
  const width = Math.min(padWidth * 0.92, length * 0.62)
  const cap = Math.max(length * CAP_SHARE, 0.1)
  const h = input.height
  const half = length / 2
  const local = (minX: number, maxX: number, w: number): Rect => ({ minX, maxX, minY: -w / 2, maxY: w / 2 })
  const { look } = input
  const bodyTop = h * 0.97
  const pieces: Piece[] = [
    ...box(local(-half, -half + cap, width * 1.02), 0, h, look.metal, "metal", "cap"),
    ...box(local(half - cap, half, width * 1.02), 0, h, look.metal, "metal", "cap"),
    ...box(local(-half + cap, half - cap, width), 0.02, bodyTop, { top: look.top ?? look.body, side: look.body }, "matt", "body"),
  ]
  const same = (a: readonly number[] | undefined, b: readonly number[]) => a !== undefined && a.join() === b.join()
  if (!same(look.body, look.mark) && !same(look.top, look.mark)) {
    // The LED's cathode mark: a short bar on the lens at the pad 2 end.
    pieces.push(...box(local(half - cap - width * 0.32, half - cap - width * 0.12, width * 0.7), bodyTop - 0.01, h, look.mark, "matt", "cathode"))
  }
  const turned = turnPieces(pieces, angle).map((piece) => ({ ...piece, loops: piece.loops.map((loop) => loop.map((p): [number, number, number] => [p[0] + mid.x, p[1] + mid.y, p[2]])) }))
  return clipPieces(turned, input.limit)
}

/** Pieces moved inside the courtyard's bounds: a point outside is pulled onto the bound. Shapes are made to fit; this only catches rounding. */
export function clipPieces(pieces: readonly Piece[], limit: Rect): Piece[] {
  const inside = clipped({ minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity }, limit)
  const pull = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
  return pieces.map((piece) => ({ ...piece, loops: piece.loops.map((loop) => loop.map((p): [number, number, number] => [pull(p[0], inside.minX, inside.maxX), pull(p[1], inside.minY, inside.maxY), p[2]])) }))
}
