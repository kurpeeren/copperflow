import type { Point } from "../model.js"
import { range } from "./ic.js"
import { leadDiameter, THROUGH_HOLE_COURTYARD, throughHoleLand, throughHolePad } from "./ipc7251.js"
import { centredOffsets, courtyard, pinOneTick, tidy } from "./outline.js"
import { isSimple, type ParsedFootprint } from "./parse.js"
import type { Footprint, Pad } from "./types.js"

/**
 * TO-220AB (JEDEC), standing upright, in the dimensions makers' outline drawings commonly give:
 * three leads 2.54 mm apart, lead width 0.70–0.90 and thickness 0.45–0.60, body width up to 10.66,
 * overall thickness up to 4.83 of which the metal tab is up to 1.40. Written from general knowledge
 * of those drawings, not transcribed from one.
 *
 * Seen from the top the leads (y = 0) leave the plastic halfway through it: the front face is
 * (4.83 − 1.40)/2 in front of them (−y) and the tab behind them (+y). The origin is the middle lead,
 * not the body centre.
 */
const PITCH = 2.54
const LEAD_WIDTH = range(0.7, 0.9)
const LEAD_THICKNESS = range(0.45, 0.6)
const BODY_WIDTH = 10.66
const BODY_THICKNESS = 4.83
const TAB_THICKNESS = 1.4
/** The pin 1 tick sits this far in front of the body. */
const TICK_GAP = 0.3

const FRONT = -(BODY_THICKNESS - TAB_THICKNESS) / 2
const TAB = FRONT + BODY_THICKNESS - TAB_THICKNESS
const BACK = FRONT + BODY_THICKNESS
const HALF_WIDTH = BODY_WIDTH / 2

function body(): Point[] {
  const [x, f, b] = [tidy(HALF_WIDTH), tidy(FRONT), tidy(BACK)]
  return [{ x: -x, y: f }, { x, y: f }, { x, y: b }, { x: -x, y: b }, { x: -x, y: f }]
}

/** "to220": pads 1, 2, 3 left to right seen from the front, pad 1 square; or undefined. */
export function to220Footprint(parsed: ParsedFootprint): Footprint | undefined {
  const plain = isSimple(parsed) && parsed.variant === undefined && Object.keys(parsed.params).length === 0
  if (parsed.kind !== "to" || parsed.code !== "220" || !plain) return undefined
  const land = throughHoleLand(leadDiameter(LEAD_WIDTH, LEAD_THICKNESS))
  const pads: Pad[] = centredOffsets(3, PITCH).map((x, i) => throughHolePad(String(i + 1), x, 0, land, i === 0))
  const tab: Point[] = [{ x: -tidy(HALF_WIDTH), y: tidy(TAB) }, { x: tidy(HALF_WIDTH), y: tidy(TAB) }]
  return {
    name: "to220",
    pads,
    courtyard: courtyard(pads, { x: HALF_WIDTH, y: Math.max(-FRONT, BACK) }, THROUGH_HOLE_COURTYARD),
    silkscreen: [body(), tab, pinOneTick(pads[0] as Pad, FRONT - TICK_GAP)],
    fabrication: [body(), tab],
    origin: `Through-hole, TO-220 upright: ${land.drill} mm holes, ${land.pad} mm lands (IPC-2222 level B)`,
  }
}
