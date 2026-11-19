// The case sizes of a general-purpose radial aluminium electrolytic series, by rated voltage and capacitance: the can
// a part with that rating is made in. Read from Nichicon's UVR data sheet (CAT.8100M, "Dimensions", pages 2 to 4),
// which lists the 8 mm and larger cans; smaller cans are not in it, so a rating not listed here has no case size and
// the can keeps the common length for its diameter. Pure.
import { parseQuantity } from "../sim/values.js"

export const RADIAL_RATINGS_DOCUMENT = "Nichicon UVR data sheet CAT.8100M, Dimensions, pp2-4"

/** [rated voltage V, capacitance µF, diameter mm, length mm] */
type Rating = readonly [number, number, number, number]

const RATINGS: readonly Rating[] = [
  [6.3, 1000, 8, 11.5], [6.3, 2200, 10, 20], [6.3, 3300, 10, 20], [6.3, 4700, 12.5, 20], [6.3, 6800, 12.5, 25], [6.3, 10000, 16, 25], [6.3, 15000, 16, 35.5], [6.3, 22000, 18, 40],
  [10, 1000, 10, 12.5], [10, 2200, 10, 20], [10, 3300, 12.5, 20], [10, 4700, 12.5, 25], [10, 6800, 16, 25], [10, 10000, 16, 35.5], [10, 15000, 18, 35.5],
  [16, 330, 8, 11.5], [16, 470, 8, 11.5], [16, 1000, 10, 16], [16, 2200, 12.5, 20], [16, 3300, 12.5, 25], [16, 4700, 16, 25], [16, 6800, 16, 35.5], [16, 10000, 18, 35.5],
  [25, 220, 8, 11.5], [25, 330, 10, 12.5], [25, 470, 10, 12.5], [25, 1000, 10, 20], [25, 2200, 12.5, 25], [25, 3300, 16, 25], [25, 4700, 16, 30.5], [25, 6800, 18, 35.5],
  [35, 220, 10, 12.5], [35, 330, 10, 12.5], [35, 470, 10, 16], [35, 1000, 12.5, 20], [35, 2200, 16, 25], [35, 3300, 16, 35.5], [35, 4700, 18, 35.5],
  [50, 100, 8, 11.5], [50, 220, 10, 12.5], [50, 330, 10, 16], [50, 470, 12.5, 20], [50, 1000, 12.5, 25], [50, 2200, 16, 35.5], [50, 3300, 18, 35.5],
  [63, 100, 10, 12.5], [63, 220, 10, 16], [63, 330, 10, 20], [63, 470, 12.5, 20], [63, 1000, 16, 25], [63, 2200, 18, 35.5],
  [100, 33, 8, 11.5], [100, 47, 10, 12.5], [100, 100, 10, 20], [100, 220, 12.5, 25], [100, 330, 12.5, 25], [100, 470, 16, 25], [100, 1000, 18, 40],
  [160, 10, 8, 11.5], [160, 22, 10, 16], [160, 33, 10, 20], [160, 47, 12.5, 20], [160, 100, 12.5, 25], [160, 220, 16, 35.5], [160, 330, 18, 40],
  [200, 4.7, 8, 11.5], [200, 10, 10, 12.5], [200, 22, 10, 20], [200, 33, 12.5, 20], [200, 47, 12.5, 20], [200, 100, 16, 30.5], [200, 220, 18, 35.5],
  [250, 3.3, 8, 11.5], [250, 4.7, 8, 11.5], [250, 10, 10, 16], [250, 22, 12.5, 20], [250, 33, 12.5, 20], [250, 47, 12.5, 25], [250, 100, 16, 30.5],
  [315, 2.2, 8, 11.5], [315, 3.3, 10, 12.5], [315, 4.7, 10, 12.5], [315, 10, 10, 20], [315, 22, 12.5, 20], [315, 33, 16, 25], [315, 47, 16, 25], [315, 100, 18, 35.5],
  [350, 2.2, 8, 11.5], [350, 3.3, 10, 12.5], [350, 4.7, 10, 12.5], [350, 10, 10, 20], [350, 22, 12.5, 25], [350, 33, 16, 25], [350, 47, 16, 35.5], [350, 100, 18, 40],
  [400, 1, 8, 11.5], [400, 2.2, 10, 12.5], [400, 3.3, 10, 12.5], [400, 4.7, 10, 16], [400, 10, 12.5, 20], [400, 22, 16, 25], [400, 33, 16, 30.5], [400, 47, 16, 35.5],
  [450, 1, 8, 11.5], [450, 2.2, 10, 12.5], [450, 3.3, 10, 16], [450, 4.7, 10, 20], [450, 10, 12.5, 20], [450, 22, 16, 25], [450, 33, 16, 35.5], [450, 47, 18, 40],
]

export interface RadialCase {
  volts: number
  microfarads: number
  diameter: number
  length: number
}

/** The capacitor's rated voltage: its `voltageRating` prop, or `maxVoltageRating` as the simulator also reads it. */
export const ratedVolts = (props: Readonly<Record<string, unknown>>): number | undefined => {
  const volts = parseQuantity(props["voltageRating"] ?? props["maxVoltageRating"])
  return volts !== undefined && volts > 0 ? volts : undefined
}

/** The capacitance in µF from the `capacitance` prop ("100uF", "100µF", 1e-4). */
export const microfaradsOf = (props: Readonly<Record<string, unknown>>): number | undefined => {
  const farads = parseQuantity(props["capacitance"])
  return farads !== undefined && farads > 0 ? farads * 1e6 : undefined
}

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(Math.abs(a), Math.abs(b))

/** The case the series makes this rating in, or undefined when the rating is not in its table. */
export function radialCase(props: Readonly<Record<string, unknown>>): RadialCase | undefined {
  const [volts, microfarads] = [ratedVolts(props), microfaradsOf(props)]
  if (volts === undefined || microfarads === undefined) return undefined
  const row = RATINGS.find(([v, c]) => same(v, volts) && same(c, microfarads))
  return row === undefined ? undefined : { volts: row[0], microfarads: row[1], diameter: row[2], length: row[3] }
}
