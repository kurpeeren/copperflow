import type { Point } from "../model.js"
import { range } from "./ic.js"
import { leadDiameter, THROUGH_HOLE_COURTYARD, throughHoleLand, throughHolePad } from "./ipc7251.js"
import { arcPoints, courtyard, padExtent, pinOneTick, SILK_CLEARANCE, tidy } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/**
 * HC-49/U and its low-profile form HC-49/S (often sold as HC-49/US), both through-hole, in the
 * dimensions crystal makers' drawings commonly give: leads 4.88 mm apart, lead diameter 0.40–0.46,
 * case 11.05 × 4.65 mm with round ends. The two differ only in height, so their footprints are the
 * same. Written from general knowledge of those drawings, not transcribed from one.
 */
const PITCH = 4.88
const LEAD = range(0.4, 0.46)
const LENGTH = 11.05
const WIDTH = 4.65
/** The pin 1 tick sits this far below the silkscreen clearance of pad 1, inside the case. */
const TICK_GAP = 0.2

const LABELS = new Map<string | undefined, string>([
  [undefined, "HC-49/U"],
  ["s", "HC-49/S"],
])

/** The case seen from the top: two straight sides joined by half circles. */
function caseOutline(): Point[] {
  const r = WIDTH / 2
  const c = LENGTH / 2 - r
  const right = arcPoints({ x: c, y: 0 }, r, -90, 90, 10)
  const left = arcPoints({ x: -c, y: 0 }, r, 90, 270, 10)
  return [...right, ...left, right[0] as Point]
}

/** "hc49" or "hc49s": two pads along x, pad 1 (square) at the left; or undefined. */
export function crystalFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const label = parsed.kind === "hc" && parsed.code === "49" ? LABELS.get(parsed.suffix) : undefined
  const plain = parsed.cross === undefined && parsed.size === undefined && parsed.pairs === undefined && parsed.variant === undefined
  if (!label || !plain || Object.keys(parsed.params).length > 0) return undefined
  const land = throughHoleLand(leadDiameter(LEAD))
  const pads: Pad[] = [throughHolePad("1", -PITCH / 2, 0, land, true), throughHolePad("2", PITCH / 2, 0, land)]
  const outline = caseOutline()
  const tickY = tidy(-(padExtent(pads).y + SILK_CLEARANCE + TICK_GAP))
  return {
    name: `hc49${parsed.suffix ?? ""}`,
    pads,
    courtyard: courtyard(pads, { x: LENGTH / 2, y: WIDTH / 2 }, THROUGH_HOLE_COURTYARD),
    silkscreen: [outline, pinOneTick(pads[0] as Pad, tickY)],
    fabrication: [outline],
    origin: `Through-hole, ${label} crystal: ${land.drill} mm holes, ${land.pad} mm lands (IPC-2222 level B)`,
  }
}

