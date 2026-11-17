import { z } from "zod"
import { parseLength } from "../units.js"
import { FOOTPRINT_FAMILIES, LIBRARY_PART_ID, type PlacementRotations } from "./rotations.js"

/** The parsed, resolved form of rules.yaml. Every length is in millimetres. Plain JSON values only. */

export interface FabricationProfile {
  name: string
  /** Where the numbers come from: page, URL, section names and the date they were read. */
  source: string
  copperLayers: 2 | 4
  minTrackWidth: number
  minClearance: number
  minDrill: number
  minAnnularRing: number
  boardEdgeClearance: number
  minHoleToHole: number
  minSilkToPad: number
  /** The radius Fillet tracks rounds corners with; not a fabrication limit, so the profiles leave it out (1 mm then). */
  filletRadius?: number
  /** How far the solder mask opening grows past each pad, in mm; the profiles leave it out (0.05 mm then). */
  maskExpansion?: number
  /** How far the solder paste shrinks inside each SMD pad, in mm; the profiles leave it out (0 then). */
  pasteReduction?: number
  /**
   * Degrees added to the rotation in the pick-and-place file, per footprint family, and per library part (by its id)
   * for the parts whose footprint is that part's footprint file; the profiles leave it out (0 then).
   */
  placementRotations?: PlacementRotations
  /** The finished board's thickness, in mm: what a via adds to a length, and on 2 layers the dielectric with the copper. */
  boardThickness?: number
  /** The dielectric's relative permittivity, for impedance. */
  permittivity?: number
  /** The outer copper's thickness, in mm, for impedance. */
  copperThickness?: number
  /** Whether solder mask covers the outer tracks (the impedance estimate does not count it; it says so). */
  solderMask?: boolean
  /** The dielectric under an outer track, in mm; on 2 layers the board minus its two coppers when left out. */
  dielectricHeight?: number
}

/** A pair rule: two-net pairs by name, or "by-name" for nets whose names differ only by a pair ending. */
export type PairRule = "by-name" | [string, string][]

export interface NetClass {
  name: string
  trackWidth: number
  clearance: number
  via: { drill: number; diameter: number }
  /** Net name patterns with `*` and `?`. */
  patterns: string[]
  /** Single-line impedance, in ohm. */
  impedance?: number
  /** The pairs of this class. */
  pair?: PairRule
  /** Differential impedance of its pairs, in ohm. */
  differentialImpedance?: number
  /** The gap between the two tracks of a pair, in mm. */
  gap?: number
  /** The most the two nets of a pair may differ in length, in mm. */
  maxSkew?: number
  maxLength?: number
  /** Nets that must be the same length; `maxSpread` is the most longest and shortest may differ, in mm. */
  matchGroup?: string
  maxSpread?: number
  /** The share of a pair's length, in percent, that must run side by side; 80 when left out. */
  minCoupled?: number
  /** Set when trackWidth (and gap) came from the impedance: "50 ohm single" or "90 ohm differential at a 0.2 mm gap". */
  widthFrom?: string
}

export interface ClassClearance {
  a: string
  b: string
  clearance: number
}

export interface Rules {
  fabrication: FabricationProfile
  classes: NetClass[]
  classClearance: ClassClearance[]
  globalNets: string[]
  /** Set when a rules file was read. */
  file?: string
}

// ---- the file as written ----

const length = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const parsed = parseLength(value)
  if (parsed !== undefined && parsed > 0) return parsed
  ctx.issues.push({ code: "custom", message: `"${String(value)}" is not a positive length such as 0.2, 0.2mm or 8mil`, input: value })
  return z.NEVER
})

const nonNegativeLength = z.union([z.number(), z.string()]).transform((value, ctx) => {
  const parsed = parseLength(value)
  if (parsed !== undefined && parsed >= 0) return parsed
  ctx.issues.push({ code: "custom", message: `"${String(value)}" is not a length of 0 or more such as 0, 0.05mm or 2mil`, input: value })
  return z.NEVER
})

const degrees = z.number().finite()

const FabricationSchema = z
  .object({
    profile: z.string().optional(),
    minTrackWidth: length.optional(),
    minClearance: length.optional(),
    minDrill: length.optional(),
    minAnnularRing: length.optional(),
    boardEdgeClearance: length.optional(),
    minHoleToHole: length.optional(),
    minSilkToPad: length.optional(),
    filletRadius: length.optional(),
    maskExpansion: nonNegativeLength.optional(),
    pasteReduction: nonNegativeLength.optional(),
    boardThickness: length.optional(),
    permittivity: z.number().min(1, "a relative permittivity of 1 or more, such as 4.6").max(20, "a relative permittivity of at most 20").optional(),
    copperThickness: length.optional(),
    solderMask: z.boolean().optional(),
    dielectricHeight: length.optional(),
    placementRotations: z
      .object({
        ...Object.fromEntries(FOOTPRINT_FAMILIES.map((family) => [family, degrees.optional()])),
        parts: z.record(z.string().regex(LIBRARY_PART_ID, "a library part id such as MCP2515"), degrees).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

const NetClassSchema = z
  .object({
    trackWidth: length.optional(),
    clearance: length.optional(),
    via: z.object({ drill: length.optional(), diameter: length.optional() }).strict().optional(),
    nets: z.array(z.string().min(1)),
    impedance: z.number().min(10, "an impedance from 10 to 200 ohm").max(200, "an impedance from 10 to 200 ohm").optional(),
    differentialImpedance: z.number().min(20, "a differential impedance from 20 to 300 ohm").max(300, "a differential impedance from 20 to 300 ohm").optional(),
    pair: z.union([z.literal("by-name"), z.array(z.tuple([z.string().min(1), z.string().min(1)]))]).optional(),
    gap: length.optional(),
    maxSkew: nonNegativeLength.optional(),
    maxLength: length.optional(),
    matchGroup: z.string().min(1).optional(),
    maxSpread: nonNegativeLength.optional(),
    minCoupled: z.number().min(0, "a share from 0 to 100 %").max(100, "a share from 0 to 100 %").optional(),
  })
  .strict()
  .refine((c) => c.maxSpread === undefined || c.matchGroup !== undefined, { message: "maxSpread needs a matchGroup", path: ["maxSpread"] })

/** What rules.yaml may hold; unknown keys are errors. */
export const RulesFileSchema = z
  .object({
    fabrication: FabricationSchema.optional(),
    netClasses: z.record(z.string(), NetClassSchema).optional(),
    classClearance: z.array(z.tuple([z.string(), z.string(), length])).optional(),
    globalNets: z.array(z.string().min(1)).optional(),
  })
  .strict()

export type RulesFile = z.infer<typeof RulesFileSchema>
