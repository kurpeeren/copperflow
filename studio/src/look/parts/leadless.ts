// A leadless chip (QFN, DFN): a dark body over its pads with a pin 1 dot, and a thin metal terminal showing at the
// body's foot over each pad. No legs. Pure.
import { clipPieces } from "./chip.js"
import { box, circle, clipped, grown, prism, type Piece } from "./kit.js"
import { firstPad, padRect, type ShapeInput } from "./input.js"
import { bodyRect } from "./gullwing.js"

const TERMINAL = 0.2

export function leadlessShape(input: ShapeInput): Piece[] {
  // A leadless body covers its pads: the outline when there is one, else the pads' outer bounds.
  const outer = input.pads.reduce((r, pad) => {
    const p = padRect(pad)
    return { minX: Math.min(r.minX, p.minX), minY: Math.min(r.minY, p.minY), maxX: Math.max(r.maxX, p.maxX), maxY: Math.max(r.maxY, p.maxY) }
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
  const body = clipped(input.body ?? (Number.isFinite(outer.minX) ? grown(outer, -0.05) : bodyRect(input)), input.limit)
  const h = input.height
  const top = h - 0.02
  const { look } = input
  const pieces: Piece[] = [...box(body, TERMINAL * 0.5, top, look.body, "matt", "body")]
  for (const pad of input.pads) pieces.push(...box(clipped(padRect(pad), grown(body, 0.01)), 0, TERMINAL, look.metal, "metal", "leg"))
  const one = firstPad(input.pads)
  if (one !== undefined) {
    const small = Math.min(body.maxX - body.minX, body.maxY - body.minY)
    const radius = Math.min(small * 0.1, 0.35)
    const inset = radius + small * 0.1
    const x = one.x < (body.minX + body.maxX) / 2 ? body.minX + inset : body.maxX - inset
    const y = one.y < (body.minY + body.maxY) / 2 ? body.minY + inset : body.maxY - inset
    pieces.push(...prism(circle(x, y, radius, 12), top - 0.01, h, look.mark, "matt", "pin1"))
  }
  return clipPieces(pieces, input.limit)
}
