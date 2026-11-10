import type { Point } from "../model.js"
import { mm } from "./exposed.js"
import { range } from "./ic.js"
import { leadDiameter, THROUGH_HOLE_COURTYARD, throughHoleLand, throughHolePad } from "./ipc7251.js"
import { arcPoints, bodyOutline, centredOffsets, courtyard, padExtent, SILK_CLEARANCE, tidy, type Extent } from "./outline.js"
import { isSimple, type ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/**
 * JEDEC MS-001 (300 mil) and MS-011 (600 mil) plastic DIPs, typical values written from general
 * knowledge of those outlines: pitch 2.54, lead width 0.36–0.56, lead thickness 0.20–0.36. The body
 * is drawn (w − 1.27) wide and N/2 × 2.54 long, a simplification of the outline's body.
 */
const PITCH = 2.54
const LEAD_WIDTH = range(0.36, 0.56)
const LEAD_THICKNESS = range(0.2, 0.36)
const BODY_INSET = 1.27
export const DIP_DEFAULT_ROW_SPACING = 7.62

/** Only guards against runaway strings; it is not a part limit. */
const MAX_PINS = 64
/** The orientation notch at the top of the silkscreen outline. */
const NOTCH_RADIUS = 0.75

/** Pad 1 at the top of the left column, square; the left column runs down, the right column back up. */
function dipPads(pins: number, spacing: number): Pad[] {
  const land = throughHoleLand(leadDiameter(LEAD_WIDTH, LEAD_THICKNESS))
  const ys = centredOffsets(pins / 2, PITCH)
  const left = [...ys].reverse().map((y, i) => throughHolePad(String(i + 1), tidy(-spacing / 2), y, land, i === 0))
  const right = ys.map((y, i) => throughHolePad(String(pins / 2 + i + 1), tidy(spacing / 2), y, land))
  return [...left, ...right]
}

/** A rectangle between the two columns with the orientation notch at the top, pin 1's end. */
function dipSilkscreen(pads: readonly Pad[], body: Extent): Point[][] {
  const inner = Math.min(...pads.map((p) => Math.abs(p.x) - p.width / 2))
  const x = tidy(Math.min(body.x, inner - SILK_CLEARANCE))
  const y = tidy(Math.max(body.y, padExtent(pads).y + SILK_CLEARANCE))
  const notch = arcPoints({ x: 0, y }, NOTCH_RADIUS, 0, -180, 15)
  return [[{ x: -NOTCH_RADIUS, y }, { x: -x, y }, { x: -x, y: -y }, { x, y: -y }, { x, y }, ...notch]]
}

/**
 * "dip<N>", with `_w<mm>` for the row spacing (7.62 mm, 300 mil, unless given; never narrower), or
 * undefined.
 */
export function dipFootprint(parsed: ParsedFootprint): Footprint | undefined {
  if (parsed.kind !== "dip" || !isSimple(parsed) || parsed.variant !== undefined) return undefined
  if (Object.keys(parsed.params).some((key) => key !== "w")) return undefined
  const pins = Number(parsed.code)
  const spacing = parsed.params["w"] ?? DIP_DEFAULT_ROW_SPACING
  if (!Number.isInteger(pins) || pins < 4 || pins > MAX_PINS || pins % 2 !== 0) return undefined
  if (spacing === true || spacing < DIP_DEFAULT_ROW_SPACING - 1e-9) return undefined
  const pads = dipPads(pins, spacing)
  const body = { x: (spacing - BODY_INSET) / 2, y: (pins / 2) * (PITCH / 2) }
  const land = pads[0] as Pad
  return {
    name: Math.abs(spacing - DIP_DEFAULT_ROW_SPACING) < 1e-9 ? `dip${pins}` : `dip${pins}_w${mm(spacing)}`,
    pads,
    courtyard: courtyard(pads, body, THROUGH_HOLE_COURTYARD),
    silkscreen: dipSilkscreen(pads, body),
    fabrication: bodyOutline(body),
    origin: `Through-hole, DIP-${pins} with rows ${mm(spacing)} mm apart: ${mm(land.drill?.width ?? 0)} mm holes, ${mm(land.width)} mm lands (IPC-2222 level B)`,
  }
}
