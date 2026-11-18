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
 * The small SOTs take SOT-23's 180 because they are drawn as it is (pin 1 at the left of the bottom row, counter-clockwise);
 * that has not been confirmed in JLCPCB's assembly preview for each of them, and `fabrication.placementRotations`
 * overrides it.
 * Strings that are drawn as their sibling's and share its zero orientation have no family of their own: the small
 * SOTs ("sot323", "sc70", "sot143", "sot23_8" ...) are `sot`, MiniMELF and MELF ("minimelf", "melf", "sod80",
 * "do213aa", "do213ab") and the other SODs are `sod`, "to220_2" and "to220_5" are `to220`,
 * "to252" is `dpak`, "to263" is `d2pak`, the axial diodes ("do35", "do41", "do15", "do201ad") are `axial`, and a
 * dual package with an exposed pad ("msop8_ep1.7x1.9") keeps its kind.
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
  "msop",
  "qsop",
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
  "tant",
  "array",
  "dpak",
  "d2pak",
  "plcc",
  "smdip",
  "dip",
  "axial",
  "to220",
  "to247",
  "to126",
  "to92",
  "hc49",
  "hc49s",
  "hc49smd",
  "xtal",
  "radial",
  "smdcan",
  "ledth",
  "ledsmd",
  "pinrow",
  "pinrow2x",
  "socket",
  "socket2x",
  "screw",
  "resonator",
  "usb",
  "dcjack",
  "tact",
  "ind",
  "file",
] as const
export type FootprintFamily = (typeof FOOTPRINT_FAMILIES)[number]

/** rules.yaml's corrections: per family, and per library part for the parts drawn with that part's footprint file. */
export type PlacementRotations = Partial<Record<FootprintFamily, number>> & { parts?: Record<string, number> }

/**
 * The corrections when rules.yaml sets none. copperflow's footprints are drawn at IPC-7351B's zero orientation, pin 1
 * at the top left; JLCPCB's part models for SOIC, SOP, SSOP and TSSOP packages need the commonly used 270 degrees, and SOT-23
 * 180, and SOT-223 180 as well; MSOP and QSOP are drawn by the same generator as TSSOP and SSOP and take their 270. Chips, pin rows and footprint
 * files stay 0, and so do the families whose correction is not well established (every family added with the generated
 * packages except SOT-223, MSOP and QSOP; the small SOTs share `sot`, see above).
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
  // MSOP and QSOP are drawn exactly as TSSOP and SSOP (`dual.ts`: the same generator, pin 1 at the top of the
  // left column, counter-clockwise), so they take the same correction; the assembly preview is the check.
  msop: 270,
  qsop: 270,
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
  tant: 0,
  array: 0,
  dpak: 0,
  d2pak: 0,
  plcc: 0,
  smdip: 0,
  dip: 0,
  axial: 0,
  to220: 0,
  to247: 0,
  to126: 0,
  to92: 0,
  hc49: 0,
  hc49s: 0,
  hc49smd: 0,
  xtal: 0,
  radial: 0,
  smdcan: 0,
  ledth: 0,
  ledsmd: 0,
  pinrow: 0,
  pinrow2x: 0,
  socket: 0,
  socket2x: 0,
  screw: 0,
  resonator: 0,
  usb: 0,
  dcjack: 0,
  tact: 0,
  ind: 0,
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
  if (kind === "sc" || kind === "sot") return "sot"
  if (kind === "minimelf" || kind === "melf") return "sod"
  if (kind === "do" && code === "213") return "sod"
  if (kind === "do" && ["35", "41", "15", "201"].includes(code)) return "axial"
  if (kind === "to" && (code === "252" || code === "263")) return code === "252" ? "dpak" : "d2pak"
  if (kind === "d" && code === "2" && suffix === "pak") return "d2pak"
  if (kind === "led") return suffix === "mm" ? "ledth" : "ledsmd"
  if (kind === "socket" && parsed.cross !== undefined) return "socket2x"
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
