// What the 3D model is not, in the words a person reads beside it: the export's answer and the Studio's 3D view.
import { naturalCompare } from "../order.js"
import type { PartSolid } from "./model.js"

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

/** The export's line about its STEP file: what it is not, and which parts' heights are typical or assumed. */
export function modelLine(file: string, parts: readonly Pick<PartSolid, "name" | "state">[]): string {
  const typical = named(parts, "typical")
  const assumed = named(parts, "assumed")
  return `${file}: parts are boxes, not their real shapes; heights marked typical come from a package table, assumed ones are guesses (${typical}${typical.startsWith("none") && assumed.startsWith("none") ? ", " : "; "}${assumed}).`
}
