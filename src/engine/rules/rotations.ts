// The pick-and-place rotation correction per footprint family: the degrees (counter-clockwise) added to a part's own
// rotation so the assembler's part model sits as copperflow's footprint does. Pure.
import { parseFootprint, type ParsedFootprint } from "../footprints/parse.js"
import type { FabricationProfile } from "./schema.js"

/** A library part's id, as the parts library accepts it: the key of a per-part correction. */
export const LIBRARY_PART_ID = /^[A-Za-z](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/
/** The footprint file of a library part, whose id the per-part corrections are keyed by. */
const PART_FOOTPRINT_FILE = /^parts\/([^/]+)\/footprint\.yaml$/

/**
 * The families copperflow makes footprints for, by the letters of the footprint string (with the package code where
 * one kind holds packages of different shapes: "sot223", "do214ac", "to92", "hc49s", "pinrow2x"), and footprint files.
 */
export const FOOTPRINT_FAMILIES = [
  "chip",
  "sod",
  "sot",
  "sot223",
  "sot89",
  "soic",
  "sop",
  "ssop",
  "tssop",
  "qfn",
  "dfn",
  "qfp",
  "lqfp",
  "tqfp",
  "bga",
  "sma",
  "smb",
  "smc",
  "do214ac",
  "do214aa",
  "do214ab",
  "dip",
  "to220",
  "to92",
  "hc49",
  "hc49s",
  "radial",
  "pinrow",
  "pinrow2x",
  "file",
] as const
export type FootprintFamily = (typeof FOOTPRINT_FAMILIES)[number]

/** rules.yaml's corrections: per family, and per library part for the parts drawn with that part's footprint file. */
export type PlacementRotations = Partial<Record<FootprintFamily, number>> & { parts?: Record<string, number> }

/**
 * The corrections when rules.yaml sets none. copperflow's footprints are drawn at IPC-7351B's zero orientation, pin 1
 * at the top left; JLCPCB's part models for SOIC, SOP, SSOP and TSSOP packages need the commonly used 270 degrees, and SOT-23
 * 180, and SOT-223 180 as well. Chips, pin rows and footprint files stay 0, and so do the families whose correction is
 * not well established (every family added with the generated packages except SOT-223).
 * JLCPCB's assembly preview is the final check: a person who sees a part turned there sets
 * `fabrication.placementRotations` for its family or its library part.
 */
export const PLACEMENT_ROTATIONS: Readonly<Record<FootprintFamily, number>> = {
  chip: 0,
  sod: 0,
  sot: 180,
  sot223: 180,
  sot89: 0,
  soic: 270,
  sop: 270,
  ssop: 270,
  tssop: 270,
  qfn: 0,
  dfn: 0,
  qfp: 0,
  lqfp: 0,
  tqfp: 0,
  bga: 0,
  sma: 0,
  smb: 0,
  smc: 0,
  do214ac: 0,
  do214aa: 0,
  do214ab: 0,
  dip: 0,
  to220: 0,
  to92: 0,
  hc49: 0,
  hc49s: 0,
  radial: 0,
  pinrow: 0,
  pinrow2x: 0,
  file: 0,
}

const isFamily = (kind: string): kind is FootprintFamily => (FOOTPRINT_FAMILIES as readonly string[]).includes(kind)

/** A footprint's family from its string or name: "0805" is chip, "soic8" soic, a path a footprint file. */
export function footprintFamily(footprint: string): FootprintFamily | undefined {
  if (footprint.includes("/")) return "file"
  const parsed = parseFootprint(footprint)
  if (parsed === undefined) return undefined
  const kind = familyName(parsed)
  return isFamily(kind) ? kind : undefined
}

/** The family name a parsed string belongs to, before checking that it is one. */
function familyName(parsed: ParsedFootprint): string {
  const { kind, code, suffix = "" } = parsed
  if (kind === "") return "chip"
  if (kind === "sot" && (code === "223" || code === "89")) return `sot${code}`
  if (kind === "do" || kind === "to" || kind === "hc") return `${kind}${code}${suffix}`
  if (kind === "pinrow" && parsed.cross !== undefined) return `pinrow${code}x`
  return kind
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
