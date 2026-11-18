// A pin header (2.54 mm, or a finer pitch with its base and pins scaled down to fit): a black plastic base along its pads
// and a square gold pin standing on every pad, the pin going on through the board as a lead below it. Pure.
import { clipPieces } from "./chip.js"
import { box, clipped, hanging, rectPolygon, type Piece } from "./kit.js"
import { LEAD_TAIL, padsRect, type ShapeInput } from "./input.js"

const PITCH = 2.54
const BASE = 2.5
const PIN = 0.64

/** The pitch the string gives (`_p`), else 2.54 mm. */
const pitchOf = (input: ShapeInput): number => {
  const given = input.parsed?.params["p"]
  return typeof given === "number" && given > 0 ? given : PITCH
}

export function headerShape(input: ShapeInput): Piece[] {
  const pads = padsRect(input.pads)
  if (pads === undefined) return []
  const xs = input.pads.map((p) => p.x)
  const ys = input.pads.map((p) => p.y)
  const pitch = pitchOf(input)
  const scale = Math.min(1, pitch / PITCH)
  const [baseHeight, pinSize] = [BASE * scale, PIN * scale]
  const half = pitch / 2
  const base = clipped({ minX: Math.min(...xs) - half, maxX: Math.max(...xs) + half, minY: Math.min(...ys) - half, maxY: Math.max(...ys) + half }, input.limit)
  const h = input.height
  const { look } = input
  const baseTop = Math.min(baseHeight, h * 0.4)
  const pieces: Piece[] = [...box(base, 0, baseTop, look.body, "matt", "body")]
  for (const pad of input.pads) {
    const pin = { minX: pad.x - pinSize / 2, maxX: pad.x + pinSize / 2, minY: pad.y - pinSize / 2, maxY: pad.y + pinSize / 2 }
    pieces.push(...box(pin, baseTop, h, look.metal, "metal", "pin"))
    pieces.push(...hanging(rectPolygon(pin), 0, -(input.thickness + LEAD_TAIL), look.metal, "metal", "lead"))
  }
  return clipPieces(pieces.filter((p) => p.role !== "lead"), input.limit).concat(pieces.filter((p) => p.role === "lead"))
}
