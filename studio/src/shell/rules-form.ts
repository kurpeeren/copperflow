// Design → Design rules: the Fillet radius field as the panel shows it (the radius rules.yaml sets, or empty with the
// default as its placeholder) and as it reads what was typed (a length in any unit rules.yaml takes; empty is the
// default). Pure; plain TypeScript with .js imports, so the tests can run it.
import type { FabricationProfile } from "../../../src/engine/rules/schema.js"
import { DEFAULT_FILLET_RADIUS, MAX_FILLET_RADIUS } from "../../../src/engine/rules/track-defaults.js"
import { parseLength } from "../../../src/engine/units.js"

export const FILLET_RADIUS_LABEL = "Fillet radius"
/** Under the field: the default and the floor rule. */
export const FILLET_RADIUS_NOTE = `Edit → Fillet tracks rounds corners with this radius. Empty is the default, ${DEFAULT_FILLET_RADIUS} mm. A track's width is the floor: a smaller radius is raised to the width.`

/** The field's text and placeholder for the rules the build read. */
export function filletRadiusField(fabrication: Pick<FabricationProfile, "filletRadius"> | undefined): { value: string; placeholder: string } {
  const radius = fabrication?.filletRadius
  return { value: radius === undefined ? "" : String(radius), placeholder: `${DEFAULT_FILLET_RADIUS} mm (default)` }
}

/** What was typed, as the radius to write in mm (null for the default), or why it cannot be taken. */
export function readFilletRadius(text: string): { radius: number | null } | { message: string } {
  if (text.trim() === "") return { radius: null }
  const value = parseLength(text)
  if (value === undefined || value <= 0 || value > MAX_FILLET_RADIUS) {
    return { message: `Type a length above 0 and at most ${MAX_FILLET_RADIUS} mm, such as 1, 0.5mm or 40mil, or leave it empty for the default.` }
  }
  return { radius: Math.round(value * 1e6) / 1e6 }
}
