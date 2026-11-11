import type { Point } from "../model.js"
import { range } from "./ic.js"
import { leadDiameter, THROUGH_HOLE_COURTYARD, throughHoleLand, throughHolePad } from "./ipc7251.js"
import { arcPoints, courtyard, pinOneTick, runsClearOf, tidy } from "./outline.js"
import { isSimple, type ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/**
 * TO-92 (JEDEC), in the dimensions makers' outline drawings commonly give: body diameter up to
 * 5.21, depth from the flat face to the back up to 4.19, lead width 0.36–0.53 and thickness
 * 0.36–0.51. Written from general knowledge of those drawings, not transcribed from one.
 *
 * The leads are taken formed to 2.54 mm, as in the taped "formed lead" option most makers offer:
 * the straight 1.27 mm pitch leaves no room for the IPC-2222 land of these leads.
 */
const PITCH = 2.54
const LEAD_WIDTH = range(0.36, 0.53)
const LEAD_THICKNESS = range(0.36, 0.51)
const RADIUS = 5.21 / 2
const DEPTH = 4.19
/** The flat face, in front of the leads (−y); the round back is centred on the lead row. */
const FLAT = -(DEPTH - RADIUS)
const TICK_GAP = 0.3

/** The body seen from the top: the flat face and the round back, as one closed outline. */
function outline(): Point[] {
  const corner = (Math.asin(FLAT / RADIUS) * 180) / Math.PI
  return arcPoints({ x: 0, y: 0 }, RADIUS, corner, 180 - corner, 2).concat([arcPoints({ x: 0, y: 0 }, RADIUS, corner, corner)[0] as Point])
}

/** "to92": pads 1, 2, 3 left to right seen from the flat face, pad 1 square; or undefined. */
export function to92Footprint(parsed: ParsedFootprint): Footprint | undefined {
  const plain = isSimple(parsed) && parsed.variant === undefined && Object.keys(parsed.params).length === 0
  if (parsed.kind !== "to" || parsed.code !== "92" || !plain) return undefined
  const land = throughHoleLand(leadDiameter(LEAD_WIDTH, LEAD_THICKNESS))
  const pads: Pad[] = [-PITCH, 0, PITCH].map((x, i) => throughHolePad(String(i + 1), x, 0, land, i === 0))
  const body = outline()
  return {
    name: "to92",
    pads,
    courtyard: courtyard(pads, { x: RADIUS, y: RADIUS }, THROUGH_HOLE_COURTYARD),
    silkscreen: [...runsClearOf(body, pads), pinOneTick(pads[0] as Pad, tidy(FLAT - TICK_GAP))],
    fabrication: [body],
    origin: `Through-hole, TO-92 with leads formed to 2.54 mm: ${land.drill} mm holes, ${land.pad} mm lands (IPC-2222 level B)`,
  }
}
