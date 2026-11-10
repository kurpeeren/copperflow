// The pick-and-place (component placement) file in JLCPCB's columns: Designator, Mid X, Mid Y, Layer, Rotation. Pure.
//
// Positions are the part's origin (a footprint's origin is the part's middle), in mm with y up, as seen from the top
// for both sides: JLCPCB reads the bottom side without mirroring it again. copperflow places a bottom part by turning
// it `rotation` degrees and then mirroring it, so `rotation` is already its turn as seen from below, which is how
// JLCPCB reads a bottom part's rotation. The footprint family's correction is added on both sides.
import { naturalCompare } from "../order.js"
import type { PcbLayout } from "../pcb.js"
import { placementCorrection } from "../rules/rotations.js"
import type { FabricationProfile } from "../rules/schema.js"

export const PICK_AND_PLACE_COLUMNS = ["Designator", "Mid X", "Mid Y", "Layer", "Rotation"] as const

const FULL_TURN = 360
/** Positions to 0.1 µm and rotations to 0.001 degree, with trailing zeros left out. */
const POSITION_DECIMALS = 4
const ROTATION_DECIMALS = 3

/** A number with at most `decimals` decimals and no trailing zeros; never "-0". */
const trimmed = (value: number, decimals: number): string => String(Number(value.toFixed(decimals)) + 0)

const mm = (value: number): string => `${trimmed(value, POSITION_DECIMALS)}mm`

function rotation(degrees: number): string {
  const turned = Number((((degrees % FULL_TURN) + FULL_TURN) % FULL_TURN).toFixed(ROTATION_DECIMALS))
  return trimmed(turned === FULL_TURN ? 0 : turned, ROTATION_DECIMALS)
}

/** One row per part that has a footprint (parts without one have nothing to place), in designator order. */
export function pickAndPlaceCsv(pcb: PcbLayout, fabrication: FabricationProfile): string {
  const rows = pcb.parts
    .flatMap((part) => (part.footprint === undefined ? [] : [{ part, footprint: part.footprint.name }]))
    .sort((a, b) => naturalCompare(a.part.component, b.part.component))
    .map(({ part, footprint }) => [
      part.component,
      mm(part.x),
      mm(part.y),
      part.side === "bottom" ? "Bottom" : "Top",
      rotation(part.rotation + placementCorrection(footprint, fabrication)),
    ])
  return `${[[...PICK_AND_PLACE_COLUMNS], ...rows].map((row) => row.map(csvField).join(",")).join("\n")}\n`
}

/** A CSV field, quoted when it holds a comma, a quote or a line end. */
export function csvField(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
