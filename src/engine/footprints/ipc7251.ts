/**
 * Through-hole lands: the hole from the largest lead and the round land around it, after the
 * IPC-2222 / IPC-7251 rules for density level B (nominal). The numbers are written from general
 * knowledge of those standards, not transcribed from them:
 * - hole = the largest lead diameter (for a rectangular lead, its diagonal) + 0.20 mm, rounded up to
 *   0.05 mm;
 * - land = hole + 2 × 0.05 mm minimum annular ring + 0.50 mm fabrication allowance, rounded up to
 *   0.05 mm.
 */
import { roundUpToStep, type Range } from "./ipc7351.js"
import type { Pad } from "./types.js"

const HOLE_ALLOWANCE = 0.2
const MIN_ANNULAR_RING = 0.05
const FABRICATION_ALLOWANCE = 0.5
const ROUND_OFF = 0.05

/**
 * Courtyard for through-hole parts: 0.25 mm around the larger of the pads and the body, rounded up
 * to 0.05 mm, the same excess as the IPC-7351B level B surface-mount tables and the engine plan's
 * rule for pin rows.
 */
export const THROUGH_HOLE_COURTYARD = { courtyardExcess: 0.25, roundOff: ROUND_OFF }

export interface Land {
  drill: number
  pad: number
}

/** The diameter a lead needs through a hole: a round lead's diameter, a rectangular lead's diagonal. */
export function leadDiameter(width: Range, thickness?: Range): number {
  return thickness ? Math.hypot(width.max, thickness.max) : width.max
}

/** Hole and land for a lead of this diameter. */
export function throughHoleLand(diameter: number): Land {
  const drill = roundUpToStep(diameter + HOLE_ALLOWANCE, ROUND_OFF)
  return { drill, pad: roundUpToStep(drill + 2 * MIN_ANNULAR_RING + FABRICATION_ALLOWANCE, ROUND_OFF) }
}

/** A through-hole pad: square for pin 1 (`square`), round otherwise. */
export function throughHolePad(number: string, x: number, y: number, land: Land, square = false): Pad {
  return {
    number,
    shape: square ? "rect" : "circle",
    x,
    y,
    width: land.pad,
    height: land.pad,
    rotation: 0,
    layers: "through",
    drill: { width: land.drill, height: land.drill },
  }
}
