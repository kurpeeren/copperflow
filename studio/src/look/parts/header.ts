// A pin header (2.54 mm, or a finer pitch with its base and pins scaled down to fit): a black plastic base along its pads,
// moulded as one block per pin with its top edges chamfered so a V-groove runs between pins, and a square gold pin
// standing on every pad with a pointed tip, the pin going on through the board as a lead below it. Pure.
import { clipPieces } from "./chip.js"
import { box, clipped, frustum, grown, hanging, rectPolygon, type Piece } from "./kit.js"
import { LEAD_TAIL, padsRect, type ShapeInput } from "./input.js"

const PITCH = 2.54
const BASE = 2.5
const PIN = 0.64
/** The chamfer round each pin's block at the top of the base, and how far down it runs. */
const CHAMFER = 0.22
const CHAMFER_DROP = 0.3
/** The pin's tip narrows to this share of its side over this share of the side's length. */
const TIP_SHARE = 0.4
const TIP_LENGTH = 0.7

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
  const drop = Math.min(CHAMFER_DROP * scale, baseTop * 0.3)
  const pieces: Piece[] = [...box(base, 0, baseTop - drop, look.body, "matt", "body")]
  const tip = Math.min(pinSize * TIP_LENGTH, (h - baseTop) * 0.2)
  for (const pad of input.pads) {
    const cell = clipped({ minX: pad.x - half, maxX: pad.x + half, minY: pad.y - half, maxY: pad.y + half }, base)
    pieces.push(...frustum(cell, grown(cell, -CHAMFER * scale), baseTop - drop, baseTop, look.body, "matt", "body"))
    const pin = { minX: pad.x - pinSize / 2, maxX: pad.x + pinSize / 2, minY: pad.y - pinSize / 2, maxY: pad.y + pinSize / 2 }
    // The shank's own top is covered by the tip, so it is left out.
    pieces.push(...box(pin, baseTop, h - tip, look.metal, "metal", "pin").slice(1))
    pieces.push(...frustum(pin, grown(pin, -(pinSize * (1 - TIP_SHARE)) / 2), h - tip, h, look.metal, "metal", "pin"))
    pieces.push(...hanging(rectPolygon(pin), 0, -(input.thickness + LEAD_TAIL), look.metal, "metal", "lead"))
  }
  return clipPieces(pieces.filter((p) => p.role !== "lead"), input.limit).concat(pieces.filter((p) => p.role === "lead"))
}
