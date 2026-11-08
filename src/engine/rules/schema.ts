import { z } from "zod"
import { parseLength } from "../units.js"

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
}

export interface NetClass {
  name: string
  trackWidth: number
  clearance: number
  via: { drill: number; diameter: number }
  /** Net name patterns with `*` and `?`. */
  patterns: string[]
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
  })
  .strict()

const NetClassSchema = z
  .object({
    trackWidth: length.optional(),
    clearance: length.optional(),
    via: z.object({ drill: length.optional(), diameter: length.optional() }).strict().optional(),
    nets: z.array(z.string().min(1)),
  })
  .strict()

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
