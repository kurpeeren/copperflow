import { closedRectangle, courtyard } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { clearOutline, FIXED_LAND_COURTYARD, pairPads } from "./smdbox.js"
import { refuse, type Footprint, type Refusal } from "./types.js"

/**
 * Shielded surface-mount power inductors, "ind<a>x<b>" by body size in mm: two pads along x, pad 1 at −x. Not
 * polarised (the dot some makers print marks the winding start, which matters only for noise).
 *
 * Typical: written from general knowledge of shielded drum-core power inductors of these sizes (the square
 * shielded ranges of Würth, Bourns, Coilcraft, TDK), not transcribed from one maker's drawing. Lands vary a great
 * deal between makers and ranges of one size: check the chosen part's sheet.
 *   size   pad x × y   centres
 *   4x4    1.5 × 3.6   ±1.6
 *   5x5    1.8 × 4.4   ±2.0
 *   6x6    2.0 × 5.4   ±2.4
 *   8x8    2.6 × 6.0   ±3.2
 *   10x10  3.2 × 7.0   ±4.0
 *   12x12  3.6 × 5.5   ±5.0
 */
interface Size {
  side: number
  pad: { x: number; y: number }
  centre: number
}

const SIZES: readonly Size[] = [
  { side: 4, pad: { x: 1.5, y: 3.6 }, centre: 1.6 },
  { side: 5, pad: { x: 1.8, y: 4.4 }, centre: 2.0 },
  { side: 6, pad: { x: 2.0, y: 5.4 }, centre: 2.4 },
  { side: 8, pad: { x: 2.6, y: 6.0 }, centre: 3.2 },
  { side: 10, pad: { x: 3.2, y: 7.0 }, centre: 4.0 },
  { side: 12, pad: { x: 3.6, y: 5.5 }, centre: 5.0 },
]

const known = SIZES.map((size) => `${size.side}x${size.side}`).join(", ")

export function inductorFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (parsed.kind !== "ind") return undefined
  const plain = parsed.suffix === undefined && parsed.variant === undefined && parsed.size === undefined && parsed.pairs === undefined && Object.keys(parsed.params).length === 0
  const size = SIZES.find((row) => String(row.side) === parsed.code && String(row.side) === parsed.cross)
  if (!plain || !size) return refuse(`known shielded power inductor sizes are ${known}`)
  const pads = pairPads(size.centre, size.pad.x, size.pad.y)
  const half = { x: size.side / 2, y: size.side / 2 }
  const outline = closedRectangle(half)
  return {
    name: `ind${size.side}x${size.side}`,
    pads,
    courtyard: courtyard(pads, half, FIXED_LAND_COURTYARD),
    silkscreen: clearOutline(outline, pads),
    fabrication: [outline],
    origin: `Shielded power inductor ${size.side} × ${size.side} mm: fixed land pattern, typical, not from one maker's drawing`,
  }
}
