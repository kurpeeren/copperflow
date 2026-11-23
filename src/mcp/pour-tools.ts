// The fields of edit_circuit's add_pour and add_hole steps. Each step is one edit of the circuit file through the core
// (pour-edits.ts), and honours the locks by id.
import { z } from "zod"

const point = z.object({ x: z.number(), y: z.number() })
const pourLayer = z.enum(["top", "bottom", "inner1", "inner2"])

/** A pour's optional props; the core checks each value (pour-edits.ts). */
export const pourProps = z
  .object({
    priority: z.number().int().optional(),
    clearance: z.number().optional(),
    minWidth: z.number().optional(),
    thermal: z.enum(["relief", "solid"]).optional(),
    thermalWidth: z.number().optional(),
    thermalGap: z.number().optional(),
  })
  .strict()

export const pourFields = {
  net: z.string().describe('Net name, e.g. "GND"'),
  layer: pourLayer.describe("inner1, inner2 only on 4 layers"),
  outline: z.array(point).min(3).max(1000).optional().describe("Default the whole board"),
  props: pourProps.optional(),
}

export const holeFields = {
  x: z.number().describe("Centre, mm"),
  y: z.number().describe("Centre, mm"),
  diameter: z.number().describe("Drill, mm"),
}

const mmText = (n: number) => String(Math.round(n * 1e6) / 1e6)
/** "(12, 7)". */
export const pointText = (x: number, y: number) => `(${mmText(x)}, ${mmText(y)})`
