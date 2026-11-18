import type { Point } from "../model.js"
import { range } from "./ic.js"
import { leadDiameter, THROUGH_HOLE_COURTYARD, throughHoleLand, throughHolePad } from "./ipc7251.js"
import { arcPoints, courtyard } from "./outline.js"
import type { ParsedFootprint } from "./parse.js"
import { clearOutline } from "./smdbox.js"
import type { Footprint, Pad } from "./types.js"

/**
 * Through-hole round LEDs, "led3mm" and "led5mm": two square leads 0.45–0.55 mm across, 2.54 mm
 * apart; flange 3.8 mm across for the 3 mm lens and 5.8 mm for the 5 mm lens, with a flat on the
 * cathode side 0.3 mm (3 mm) or 0.5 mm (5 mm) in from the flange edge. Written from general
 * knowledge of LED makers' drawings (T-1 and T-1¾ packages), not transcribed from one.
 * Pad 1 is the anode (square), pad 2 the cathode, on the flat side at +x.
 */
const PITCH = 2.54
const LEAD = range(0.45, 0.55)

interface Lamp {
  lens: number
  flange: number
  flat: number
}

const LAMPS = new Map<string, Lamp>([
  ["3", { lens: 3, flange: 3.8, flat: 0.3 }],
  ["5", { lens: 5, flange: 5.8, flat: 0.5 }],
])

/** The flange seen from the top: a circle cut by the flat at +x, closed. */
function flangeOutline(lamp: Lamp): Point[] {
  const r = lamp.flange / 2
  const cut = r - lamp.flat
  const angle = (Math.acos(cut / r) * 180) / Math.PI
  const arc = arcPoints({ x: 0, y: 0 }, r, angle, 360 - angle, 5)
  return [...arc, arc[0] as Point]
}

/** "led3mm" or "led5mm"; undefined for anything else. */
export function ledThroughHoleFootprint(parsed: ParsedFootprint): Footprint | undefined {
  const plain = parsed.cross === undefined && parsed.variant === undefined && parsed.size === undefined && parsed.pairs === undefined
  const lamp = parsed.kind === "led" && parsed.suffix === "mm" && plain && Object.keys(parsed.params).length === 0 ? LAMPS.get(parsed.code) : undefined
  if (!lamp) return undefined
  const land = throughHoleLand(leadDiameter(LEAD, LEAD))
  const pads: Pad[] = [throughHolePad("1", -PITCH / 2, 0, land, true), throughHolePad("2", PITCH / 2, 0, land)]
  const outline = flangeOutline(lamp)
  const r = lamp.flange / 2
  return {
    name: `led${lamp.lens}mm`,
    pads,
    courtyard: courtyard(pads, { x: r, y: r }, THROUGH_HOLE_COURTYARD),
    silkscreen: clearOutline(outline, pads),
    fabrication: [outline],
    origin: `Through-hole, ${lamp.lens} mm round LED, leads 2.54 mm apart (pad 1 anode, flat at the cathode): ${land.drill} mm holes, ${land.pad} mm lands (IPC-2222 level B); body typical`,
  }
}
