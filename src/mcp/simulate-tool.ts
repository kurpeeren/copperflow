// simulate: the DC operating point, or a sheet's cases.
import { z } from "zod"

export const SIMULATE_DESCRIPTION =
  'DC operating point of a circuit, or of a sheet beside it: set nets to volts ("open" floats), close switches, energise relay coils; answers nets, sources, parts beyond a limit, then each part. With sheet and no set it runs the sheet\'s cases; no time, frequency or tolerance, and chips are not modelled.'

export const simulateInput = {
  file: z.string(),
  set: z.record(z.string(), z.union([z.number(), z.literal("open")])).optional().describe('e.g. { "V12": 12, "GND": 0, "CTRL": 3.3 }'),
  sheet: z.string().optional(),
  closed: z.array(z.string()).optional(),
  coil: z.array(z.string()).optional(),
  all: z.boolean().optional(),
}
