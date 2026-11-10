// The copper edits the Studio's server takes on POST /api/layout: the six layout edits, each with only the fields a
// person may send (the core checks the values again, and sets `by` itself). Strict, so an unknown field is refused
// before it reaches the file.
import { z } from "zod"
import { COPPER_LAYERS } from "../core/layout-file.js"

const point = z.object({ x: z.number().finite(), y: z.number().finite() }).strict()
const points = z.array(point).min(2).max(1000)
const id = z.string().min(1).max(32)
const net = z.string().min(1).max(200)
const layer = z.enum(COPPER_LAYERS)
const size = z.number().finite().positive().max(100)

export const LayoutEditSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("addTrack"), net: net.optional(), layer, width: size, points, locked: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("setTrack"), id, net: net.optional(), layer: layer.optional(), width: size.optional(), points: points.optional(), locked: z.boolean().optional() }).strict(),
  z.object({ kind: z.literal("removeTrack"), id }).strict(),
  z
    .object({ kind: z.literal("addVia"), net: net.optional(), at: point, drill: size, diameter: size, layers: z.array(layer).min(2).max(4).optional(), locked: z.boolean().optional() })
    .strict(),
  z
    .object({ kind: z.literal("setVia"), id, at: point.optional(), drill: size.optional(), diameter: size.optional(), layers: z.array(layer).min(2).max(4).optional(), locked: z.boolean().optional() })
    .strict(),
  z.object({ kind: z.literal("removeVia"), id }).strict(),
])

/** Replicate layout's placement, written into the sheet file in the same history entry: positions only. */
const SheetPlacement = z
  .object({
    file: z.string().min(1).max(500),
    edits: z.array(z.object({ kind: z.literal("setProps"), part: z.string().min(1).max(64), props: z.record(z.enum(["pcbX", "pcbY", "pcbRotation"]), z.number().finite()) }).strict()).min(1).max(500),
  })
  .strict()

export const LayoutBody = z.object({ file: z.string().min(1).max(500), summary: z.string().min(1).max(200), edits: z.array(LayoutEditSchema).min(1).max(500), sheet: SheetPlacement.optional() })
