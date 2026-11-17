// What a family's shape is made from: the part's own pads, its courtyard and body outline, its height and its colours,
// all in the part's own frame (see kit.ts). Pure.
import type { ParsedFootprint } from "../../../../src/engine/footprints/parse.js"
import type { Pad } from "../../../../src/engine/footprints/types.js"
import type { FamilyLook } from "./family.js"
import { circle, hanging, rectOf, type Flat, type Piece, type Rect } from "./kit.js"

export interface ShapeInput {
  pads: readonly Pad[]
  height: number
  /** The courtyard's bounds: nothing is drawn outside them. */
  limit: Rect
  /** The bounds of the footprint's body outline (its fabrication lines), when it has one. */
  body?: Rect
  look: FamilyLook
  parsed?: ParsedFootprint
  /** The board's thickness, for leads that go through it. */
  thickness: number
}

/** A pad's rectangle in the part's frame, its turn taken into account. */
export function padRect(pad: Pad): Rect {
  const r = (pad.rotation * Math.PI) / 180
  const [c, s] = [Math.abs(Math.cos(r)), Math.abs(Math.sin(r))]
  const [hw, hh] = [(pad.width * c + pad.height * s) / 2, (pad.width * s + pad.height * c) / 2]
  return { minX: pad.x - hw, minY: pad.y - hh, maxX: pad.x + hw, maxY: pad.y + hh }
}

export const padsRect = (pads: readonly Pad[]): Rect | undefined => rectOf(pads.flatMap((pad) => {
  const r = padRect(pad)
  return [{ x: r.minX, y: r.minY }, { x: r.maxX, y: r.maxY }]
}))

/** How far a lead reaches below the board's far side. */
export const LEAD_TAIL = 1.6

/** A lead through every through-hole pad: a round wire in the hole, from the board's surface to below its far side. */
export function leads(input: ShapeInput, color = input.look.metal): Piece[] {
  return input.pads.flatMap((pad) => {
    if (pad.layers !== "through" || pad.drill === undefined) return []
    const radius = Math.min(pad.drill.width, pad.drill.height) * 0.32
    const wire: Flat[] = circle(pad.x, pad.y, radius, 8)
    return hanging(wire, 0, -(input.thickness + LEAD_TAIL), color, "metal", "lead")
  })
}

/** Pad 1, or the first pad. */
export const firstPad = (pads: readonly Pad[]): Pad | undefined => pads.find((pad) => pad.number === "1") ?? pads[0]
