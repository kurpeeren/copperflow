import type { Point } from "../model.js"
import { mm } from "./exposed.js"
import { arcPoints, courtyard, SILK_CLEARANCE, tidy } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { clearOutline, FIXED_LAND_COURTYARD, pairPads } from "./smdbox.js"
import { refuse, type Footprint, type Pad, type Refusal } from "./types.js"

/**
 * Surface-mount aluminium electrolytic cans, "smdcan<can diameter>x<height>", on a square plastic
 * base with two corners clipped on the plus side. Pad 1 (plus) at −x, pad 2 (minus) at +x, as for
 * "radial" parts.
 *
 * Lands cited: Nichicon, "Aluminum Electrolytic Capacitors, Surface Mount Type, Recommended Land
 * Size", CAT.8100N, page 1, table "Chip type aluminum electrolytic capacitors, Standard type": pad
 * X (across the pads) × Y (along), gap a between the pads:
 *   φ4 1.6 × 2.6, a 1.0; φ5 1.6 × 3.0, a 1.4; φ6.3 1.6 × 3.5, a 1.9;
 *   φ8×5.4L / φ8×6.2L 2.5 × 4.0, a 2.1; φ8×10L 2.5 × 3.5, a 3.0; φ10 2.5 × 4.0, a 4.0.
 * https://www.nichicon.com/getmedia/29c3243e-39af-4295-a6ca-5d3658b33846/smd-reflow-and-land-pattern.pdf
 * The 8 × 6.5 can takes the φ8×6.2L row and the 8 × 10.2 can the φ8×10L row (the nearest heights
 * in that table).
 *
 * Base and corner clip written from general knowledge of can makers' drawings, not transcribed from
 * one: the base is the can diameter + 0.3 mm square, its plus-side corners clipped by a quarter of
 * the can diameter.
 */
interface Can {
  diameter: number
  height: number
  across: number
  along: number
  gap: number
}

const CANS: readonly Can[] = [
  { diameter: 4, height: 5.4, across: 1.6, along: 2.6, gap: 1.0 },
  { diameter: 5, height: 5.4, across: 1.6, along: 3.0, gap: 1.4 },
  { diameter: 6.3, height: 5.4, across: 1.6, along: 3.5, gap: 1.9 },
  { diameter: 6.3, height: 7.7, across: 1.6, along: 3.5, gap: 1.9 },
  { diameter: 8, height: 6.5, across: 2.5, along: 4.0, gap: 2.1 },
  { diameter: 8, height: 10.2, across: 2.5, along: 3.5, gap: 3.0 },
  { diameter: 10, height: 10.2, across: 2.5, along: 4.0, gap: 4.0 },
]
const BASE_MARGIN = 0.3
const CLIP_RATIO = 0.25
const PLUS_ARM = 0.4
/** The "+" stands this far beyond the silkscreen clearance above pad 1. */
const PLUS_GAP = 0.05

const sizeName = (can: Can) => `${mm(can.diameter)}x${mm(can.height)}`

/** The base seen from the top, closed, its −x corners clipped. */
function baseOutline(half: number, clip: number): Point[] {
  return [
    { x: tidy(-half + clip), y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: tidy(-half + clip), y: half },
    { x: -half, y: tidy(half - clip) },
    { x: -half, y: tidy(-half + clip) },
    { x: tidy(-half + clip), y: -half },
  ]
}

/** A "+" above pad 1, clear of it. */
function plusMark(pad: Pad): Point[][] {
  const cy = tidy(pad.y + pad.height / 2 + SILK_CLEARANCE + PLUS_GAP + PLUS_ARM)
  return [
    [{ x: tidy(pad.x - PLUS_ARM), y: cy }, { x: tidy(pad.x + PLUS_ARM), y: cy }],
    [{ x: pad.x, y: tidy(cy - PLUS_ARM) }, { x: pad.x, y: tidy(cy + PLUS_ARM) }],
  ]
}

export function smdCanFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  const plain = parsed.suffix === undefined && parsed.variant === undefined && parsed.size === undefined && parsed.pairs === undefined
  if (parsed.kind !== "smdcan" || !plain || Object.keys(parsed.params).length > 0) return undefined
  const can = CANS.find((row) => row.diameter === Number(parsed.code) && row.height === Number(parsed.cross))
  if (parsed.cross === undefined || !can) return refuse(`known surface-mount can sizes are ${CANS.map(sizeName).join(", ")}`)
  const pads = pairPads(tidy((can.gap + can.along) / 2), can.along, can.across)
  const half = tidy(can.diameter / 2 + BASE_MARGIN / 2)
  const base = baseOutline(half, tidy(can.diameter * CLIP_RATIO))
  const plus = plusMark(pads[0] as Pad)
  const plusTop = (plus[1] as Point[])[1] as Point
  return {
    name: `smdcan${sizeName(can)}`,
    pads,
    courtyard: courtyard(pads, { x: half, y: Math.max(half, plusTop.y) }, FIXED_LAND_COURTYARD),
    silkscreen: [...clearOutline(base, pads), ...plus],
    fabrication: [base, arcPoints({ x: 0, y: 0 }, can.diameter / 2, 0, 360, 5)],
    origin: `Surface-mount aluminium electrolytic, ${mm(can.diameter)} mm can ${mm(can.height)} mm high: lands from Nichicon CAT.8100N recommended land size; base typical`,
  }
}
