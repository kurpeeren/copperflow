// The pick-and-place rotation correction per footprint family: the degrees (counter-clockwise) added to a part's own
// rotation so the assembler's part model sits as copperflow's footprint does. Pure.
import { parseFootprint } from "../footprints/parse.js"
import type { FabricationProfile } from "./schema.js"

/** A library part's id, as the parts library accepts it: the key of a per-part correction. */
export const LIBRARY_PART_ID = /^[A-Za-z](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/
/** The footprint file of a library part, whose id the per-part corrections are keyed by. */
const PART_FOOTPRINT_FILE = /^parts\/([^/]+)\/footprint\.yaml$/

/** The families copperflow makes footprints for, by the letters of the footprint string, and footprint files. */
export const FOOTPRINT_FAMILIES = ["chip", "sod", "sot", "soic", "sop", "tssop", "qfn", "qfp", "pinrow", "file"] as const
export type FootprintFamily = (typeof FOOTPRINT_FAMILIES)[number]

/** rules.yaml's corrections: per family, and per library part for the parts drawn with that part's footprint file. */
export type PlacementRotations = Partial<Record<FootprintFamily, number>> & { parts?: Record<string, number> }

/**
 * The corrections when rules.yaml sets none. copperflow's footprints are drawn at IPC-7351B's zero orientation, pin 1
 * at the top left; JLCPCB's part models for SOIC, SOP and TSSOP packages need the commonly used 270 degrees, and SOT-23
 * 180. Chips, pin rows and footprint files stay 0, and so do the families whose correction is not well established.
 * JLCPCB's assembly preview is the final check: a person who sees a part turned there sets
 * `fabrication.placementRotations` for its family or its library part.
 */
export const PLACEMENT_ROTATIONS: Readonly<Record<FootprintFamily, number>> = {
  chip: 0,
  sod: 0,
  sot: 180,
  soic: 270,
  sop: 270,
  tssop: 270,
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

/** The library part a footprint file belongs to ("parts/MCP2515/footprint.yaml" gives "MCP2515"), or none. */
export const footprintFilePart = (footprint: string): string | undefined => PART_FOOTPRINT_FILE.exec(footprint)?.[1]

/**
 * The correction for a footprint: for a library part's footprint file the profile's for that part when it sets one,
 * else the profile's for its family, else the table's; 0 for a footprint of no family.
 */
export function placementCorrection(footprint: string, fabrication: FabricationProfile): number {
  const partId = footprintFilePart(footprint)
  const forPart = partId === undefined ? undefined : fabrication.placementRotations?.parts?.[partId]
  if (forPart !== undefined) return forPart
  const family = footprintFamily(footprint)
  if (family === undefined) return 0
  return fabrication.placementRotations?.[family] ?? PLACEMENT_ROTATIONS[family]
}
