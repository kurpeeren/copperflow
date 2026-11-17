// Cans: a crystal (HC-49) as a metal can with rounded ends along its two leads, and an electrolytic capacitor as a
// round can in a dark sleeve with a pale stripe on the minus side (pad 2) and a metal lid. Both with their leads. Pure.
import { clipPieces } from "./chip.js"
import { circle, prism, stadium, turnPieces, type Piece } from "./kit.js"
import { leads, type ShapeInput } from "./input.js"

const MARGIN = 0.15

export function crystalShape(input: ShapeInput): Piece[] {
  const [one, two] = [input.pads.find((p) => p.number === "1") ?? input.pads[0], input.pads.find((p) => p.number === "2") ?? input.pads[1]]
  if (one === undefined || two === undefined) return leads(input)
  const angle = (Math.atan2(two.y - one.y, two.x - one.x) * 180) / Math.PI
  const mid = { x: (one.x + two.x) / 2, y: (one.y + two.y) / 2 }
  const flat = Math.abs(Math.sin((angle * Math.PI) / 180)) > 0.7
  const limit = input.body ?? input.limit
  const along = (flat ? limit.maxY - limit.minY : limit.maxX - limit.minX) - 2 * MARGIN
  const across = (flat ? limit.maxX - limit.minX : limit.maxY - limit.minY) - 2 * MARGIN
  const width = Math.min(across, along * 0.6)
  const h = input.height
  const { look } = input
  const flange = Math.min(0.5, h * 0.1)
  const pieces = [
    ...prism(stadium(0, 0, along, width), 0, flange, look.body, "metal", "body"),
    ...prism(stadium(0, 0, along - 0.3, width - 0.3), flange, h, look.body, "metal", "body"),
  ]
  const moved = turnPieces(pieces, angle).map((piece) => ({ ...piece, loops: piece.loops.map((loop) => loop.map((p): [number, number, number] => [p[0] + mid.x, p[1] + mid.y, p[2]])) }))
  return [...clipPieces(moved, input.limit), ...leads(input)]
}

const SIDES = 24

export function electrolyticShape(input: ShapeInput): Piece[] {
  const limit = input.limit
  const radius = Math.min(limit.maxX - limit.minX, limit.maxY - limit.minY) / 2 - MARGIN
  const cx = (limit.minX + limit.maxX) / 2
  const cy = (limit.minY + limit.maxY) / 2
  const minus = input.pads.find((p) => p.number === "2")
  const towards = minus === undefined ? 0 : Math.atan2(minus.y - cy, minus.x - cx)
  const h = input.height
  const { look } = input
  const lid = Math.min(0.4, h * 0.05)
  const stripe = (i: number) => {
    const a = (2 * Math.PI * (i + 0.5)) / SIDES
    const off = Math.abs(Math.atan2(Math.sin(a - towards), Math.cos(a - towards)))
    return off < Math.PI / 6 ? look.mark : undefined
  }
  const pieces = [
    ...prism(circle(cx, cy, radius, SIDES), 0, h - lid, { top: look.top ?? look.body, side: look.body }, "matt", "body", stripe),
    ...prism(circle(cx, cy, radius * 0.9, SIDES), h - lid, h, look.top ?? look.metal, "metal", "body"),
  ]
  return [...clipPieces(pieces, input.limit), ...leads(input)]
}
