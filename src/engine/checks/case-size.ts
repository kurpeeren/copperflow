// An electrolytic capacitor whose rating a general-purpose series makes in a different can than its footprint is for:
// a 1000 µF 16 V part is a 10 mm can, so a radial8 footprint would not take it. Only ratings the series' table lists
// are checked (see solid/radial-ratings.ts). Pure.
import { parseFootprint } from "../footprints/parse.js"
import type { Circuit } from "../model.js"
import { RADIAL_RATINGS_DOCUMENT, radialCase } from "../solid/radial-ratings.js"
import { violation, type Violation } from "./violation.js"

/** "an 8 mm", "an 18 mm", "a 10 mm": the article as the number is said. */
const article = (mm: number): string => (/^(8|11|18)(\.|$)/.test(String(mm)) ? "an" : "a")

export function caseSizeChecks(circuit: Circuit): Violation[] {
  return circuit.components.flatMap((component) => {
    if (component.footprint === undefined) return []
    const parsed = parseFootprint(component.footprint)
    if (parsed?.kind !== "radial") return []
    const can = radialCase(component.props)
    const diameter = Number(parsed.code)
    if (can === undefined || !Number.isFinite(diameter) || can.diameter === diameter) return []
    const message =
      `${component.id} is ${can.microfarads} µF ${can.volts} V: a general-purpose can for that is ${can.diameter} x ${can.length} mm ` +
      `(${RADIAL_RATINGS_DOCUMENT}), but its footprint ${component.footprint} is for ${article(diameter)} ${diameter} mm can`
    return [violation("case-size", "warning", message, [component.id], "pcb")]
  })
}
