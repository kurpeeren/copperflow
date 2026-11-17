// What the 3D model is not, in the words a person reads beside it: the export's answer and the Studio's 3D view.
import { naturalCompare } from "../order.js"
import type { PartSolid } from "./model.js"

/** The 3D view's line. */
export const MODEL_LIMITS = "Parts are boxes, not their real shapes; heights marked assumed are guesses."

/** The STEP file's name for a design: "can-module.step". */
export const stepFileName = (name: string): string => `${name}.step`

/** The export's line about its STEP file: what it is not, and which parts' heights are assumed. */
export function modelLine(file: string, parts: readonly Pick<PartSolid, "name" | "assumed">[]): string {
  const assumed = parts
    .filter((part) => part.assumed)
    .map((part) => part.name)
    .sort(naturalCompare)
  return `${file}: parts are boxes, not their real shapes; heights marked assumed are guesses (${assumed.length === 0 ? "none assumed" : `assumed: ${assumed.join(", ")}`}).`
}
