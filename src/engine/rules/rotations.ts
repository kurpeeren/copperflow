// The pick-and-place rotation correction per footprint family: the degrees (counter-clockwise) added to a part's own
// rotation so the assembler's part model sits as copperflow's footprint does. Pure.
import { parseFootprint } from "../footprints/parse.js"
import type { FabricationProfile } from "./schema.js"

/** The families copperflow makes footprints for, by the letters of the footprint string, and footprint files. */
export const FOOTPRINT_FAMILIES = ["chip", "sod", "sot", "soic", "sop", "tssop", "qfn", "qfp", "pinrow", "file"] as const
export type FootprintFamily = (typeof FOOTPRINT_FAMILIES)[number]

/**
 * The corrections when rules.yaml sets none. All 0: copperflow's footprints are drawn at IPC-7351B's zero orientation,
 * and no assembler's offsets have been confirmed against them yet. A person who sees a part turned in JLCPCB's
 * assembly preview sets `fabrication.placementRotations` for its family.
 */
export const PLACEMENT_ROTATIONS: Readonly<Record<FootprintFamily, number>> = {
  chip: 0,
  sod: 0,
  sot: 0,
  soic: 0,
  sop: 0,
  tssop: 0,
  qfn: 0,
  qfp: 0,
  pinrow: 0,
  file: 0,
}

const isFamily = (kind: string): kind is FootprintFamily => (FOOTPRINT_FAMILIES as readonly string[]).includes(kind)

/** A footprint's family from its string or name: "0805" is chip, "soic8" soic, a path a footprint file. */
export function footprintFamily(footprint: string): FootprintFamily | undefined {
  if (footprint.includes("/")) return "file"
  const parsed = parseFootprint(footprint)
  if (parsed === undefined) return undefined
  const kind = parsed.kind === "" ? "chip" : parsed.kind
  return isFamily(kind) ? kind : undefined
}

/** The correction for a footprint: the profile's for its family, else the table's; 0 for a footprint of no family. */
export function placementCorrection(footprint: string, fabrication: FabricationProfile): number {
  const family = footprintFamily(footprint)
  if (family === undefined) return 0
  return fabrication.placementRotations?.[family] ?? PLACEMENT_ROTATIONS[family]
}
