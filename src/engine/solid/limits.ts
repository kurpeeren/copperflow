// What the 3D model is not, in the words a person reads beside it: the export's answer and the Studio's 3D view.
import { naturalCompare } from "../order.js"
import type { PartSolid } from "./model.js"
import type { PartShapes } from "./step-faces.js"

/** The 3D view's line. */
export const MODEL_LIMITS = "Parts are simple shapes, not their real models; heights marked typical come from a package table, assumed ones are guesses."

/** The STEP file's name for a design: "can-module.step". */
export const stepFileName = (name: string): string => `${name}.step`

const named = (parts: readonly Pick<PartSolid, "name" | "state">[], state: PartSolid["state"]): string => {
  const names = parts
    .filter((part) => part.state === state)
    .map((part) => part.name)
    .sort(naturalCompare)
  return names.length === 0 ? `none ${state}` : `${state}: ${names.join(", ")}`
}

/** What the STEP file's parts are: the 3D view's shapes, or boxes and why. */
function partsForm(shapes: PartShapes): string {
  if (shapes.faces !== undefined) return "parts are the 3D view's shapes as coloured faces (surfaces, not solids), not their real models"
  if (shapes.missing !== undefined) return `parts are boxes, not their real shapes, since their 3D shapes could not be loaded (${shapes.missing})`
  return "parts are boxes, not their real shapes"
}

/** The export's line about its STEP file: what its parts are, and which parts' heights are typical or assumed. */
export function modelLine(file: string, parts: readonly Pick<PartSolid, "name" | "state">[], shapes: PartShapes = {}): string {
  const typical = named(parts, "typical")
  const assumed = named(parts, "assumed")
  return `${file}: ${partsForm(shapes)}; heights marked typical come from a package table, assumed ones are guesses (${typical}${typical.startsWith("none") && assumed.startsWith("none") ? ", " : "; "}${assumed}).`
}
