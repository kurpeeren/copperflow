// Radial electrolytic footprints against makers' tables (solid/radial-ratings.ts): `case-size` when the capacitor's
// rating is made in a different can than its footprint is for (a 1000 µF 16 V part is a 10 mm can, so radial8 would not
// take it; only ratings the series' table lists are checked), and `lead-spacing` when the footprint's leads are not as
// far apart as makers set them for that can (a 10 mm can has its leads 5 mm apart). Pure.
import { parseFootprint } from "../footprints/parse.js"
import type { Circuit } from "../model.js"
import { LEAD_SPACING_DOCUMENT, RADIAL_RATINGS_DOCUMENT, radialCase, standardSpacing } from "../solid/radial-ratings.js"
import { violation, type Violation } from "./violation.js"

/** "an 8 mm", "an 18 mm", "a 10 mm": the article as the number is said. */
const article = (mm: number): string => (/^(8|11|18)(\.|$)/.test(String(mm)) ? "an" : "a")

function caseSize(id: string, footprint: string, props: Readonly<Record<string, unknown>>, diameter: number): Violation[] {
  const can = radialCase(props)
  if (can === undefined || can.diameter === diameter) return []
  const message =
    `${id} is ${can.microfarads} µF ${can.volts} V: a general-purpose can for that is ${can.diameter} x ${can.length} mm ` +
    `(${RADIAL_RATINGS_DOCUMENT}), but its footprint ${footprint} is for ${article(diameter)} ${diameter} mm can`
  return [violation("case-size", "warning", message, [id], "pcb")]
}

function leadSpacing(id: string, footprint: string, diameter: number, pitch: number): Violation[] {
  const standard = standardSpacing(diameter)
  if (standard === undefined || !Number.isFinite(pitch) || Math.abs(standard - pitch) < 1e-6) return []
  const message =
    `${id}'s footprint ${footprint} puts the leads ${pitch} mm apart; makers set ${standard} mm for ${article(diameter)} ` +
    `${diameter} mm can (${LEAD_SPACING_DOCUMENT}), so a part off the shelf will not fit: use radial${diameter}x${standard}`
  return [violation("lead-spacing", "warning", message, [id], "pcb")]
}

export function caseSizeChecks(circuit: Circuit): Violation[] {
  return circuit.components.flatMap((component) => {
    if (component.footprint === undefined) return []
    const parsed = parseFootprint(component.footprint)
    if (parsed?.kind !== "radial") return []
    const diameter = Number(parsed.code)
    if (!Number.isFinite(diameter)) return []
    return [
      ...caseSize(component.id, component.footprint, component.props, diameter),
      ...leadSpacing(component.id, component.footprint, diameter, Number(parsed.cross)),
    ]
  })
}
