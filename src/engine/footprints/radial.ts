import type { Point } from "../model.js"
import { MIN_PAD_GAP, mm } from "./exposed.js"
import { range } from "./ic.js"
import { leadDiameter, THROUGH_HOLE_COURTYARD, throughHoleLand, throughHolePad } from "./ipc7251.js"
import type { Range } from "./ipc7351.js"
import { arcPoints, courtyard, SILK_CLEARANCE, tidy } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/**
 * Radial electrolytic capacitors, "radial<d>x<pitch>": a can d mm across with two leads `pitch` mm
 * apart. Lead diameters as aluminium electrolytic makers commonly give them, written from general
 * knowledge of their drawings: 0.45 ± 0.05 below an 8 mm can, 0.6 ± 0.05 up to 10 mm, 0.8 ± 0.05
 * above.
 */
const LEADS: readonly { upTo: number; lead: Range }[] = [
  { upTo: 7.99, lead: range(0.4, 0.5) },
  { upTo: 10, lead: range(0.55, 0.65) },
  { upTo: Infinity, lead: range(0.75, 0.85) },
]

/** Bounds that only keep a string sane; they are not part limits. */
const MIN_DIAMETER = 3
const MAX_DIAMETER = 40
/** The "+" by pin 1: half its arm length. */
const PLUS_ARM = 0.4

/** A "+" above pad 1, its lowest point the silkscreen clearance above the pad. */
function plusMark(pad: Pad): Point[][] {
  const cy = tidy(pad.y + pad.height / 2 + SILK_CLEARANCE + 0.05 + PLUS_ARM)
  return [
    [{ x: tidy(pad.x - PLUS_ARM), y: cy }, { x: tidy(pad.x + PLUS_ARM), y: cy }],
    [{ x: tidy(pad.x), y: tidy(cy - PLUS_ARM) }, { x: tidy(pad.x), y: tidy(cy + PLUS_ARM) }],
  ]
}

/**
 * "radial<d>x<pitch>": pad 1 (square, positive) at the left, pad 2 (negative) at the right, the can
 * as a circle on the silkscreen and a "+" by pad 1; or undefined.
 */
export function radialFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const plain = parsed.suffix === undefined && parsed.size === undefined && parsed.pairs === undefined && parsed.variant === undefined
  if (parsed.kind !== "radial" || parsed.cross === undefined || !plain || Object.keys(parsed.params).length > 0) return undefined
  const diameter = Number(parsed.code)
  const pitch = Number(parsed.cross)
  const lead = LEADS.find((row) => diameter <= row.upTo)?.lead
  if (!lead || diameter < MIN_DIAMETER || diameter > MAX_DIAMETER || pitch <= 0 || pitch >= diameter) return undefined
  const land = throughHoleLand(leadDiameter(lead))
  if (pitch - land.pad < MIN_PAD_GAP) return undefined
  const pads: Pad[] = [throughHolePad("1", tidy(-pitch / 2), 0, land, true), throughHolePad("2", tidy(pitch / 2), 0, land)]
  const can = diameter / 2
  const silkRadius = Math.max(can, pitch / 2 + (land.pad * Math.SQRT2) / 2 + SILK_CLEARANCE)
  return {
    name: `radial${mm(diameter)}x${mm(pitch)}`,
    pads,
    courtyard: courtyard(pads, { x: silkRadius, y: silkRadius }, THROUGH_HOLE_COURTYARD),
    silkscreen: [arcPoints({ x: 0, y: 0 }, silkRadius, 0, 360, 5), ...plusMark(pads[0] as Pad)],
    fabrication: [arcPoints({ x: 0, y: 0 }, can, 0, 360, 5)],
    origin: `Through-hole, radial electrolytic ${mm(diameter)} mm can, leads ${mm(pitch)} mm apart: ${land.drill} mm holes, ${land.pad} mm lands (IPC-2222 level B)`,
  }
}
