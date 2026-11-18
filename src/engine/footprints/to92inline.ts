import { isSimple, type ParsedFootprint } from "./parse.js"
import { refuse, type Refusal } from "./types.js"

/**
 * "to92_inline", TO-92 with its leads straight at 1.27 mm, is refused: no land pattern there meets
 * copperflow's design rules. The lead (0.36–0.53 wide, 0.36–0.51 thick, general knowledge of makers'
 * drawings, as in `to92.ts`) has a 0.74 mm diagonal, so the IPC-2222 hole is 0.95 mm and even a hole
 * just over the diagonal is 0.75 mm. With the 0.18 mm minimum ring of the stricter shipped profile the
 * land is at least 0.75 + 0.36 = 1.11 mm wide, which leaves 0.16 mm of copper between neighbours at
 * 1.27 mm, under the 0.2 mm clearance of the default net class. The string is still recognised so
 * that the refusal says what to use instead: "to92", the leads formed to 2.54 mm.
 */
export const TO92_INLINE_REFUSAL =
  "at 1.27 mm the straight TO-92 leads leave no room for lands that meet the design rules (0.18 mm ring, 0.2 mm copper clearance); use to92, the leads formed to 2.54 mm"

/** A refusal for "to92_inline"; undefined for any other string. */
export function to92InlineFootprint(parsed: ParsedFootprint): Refusal | undefined {
  const keys = Object.keys(parsed.params)
  const inline = keys.length === 1 && parsed.params["inline"] === true
  if (parsed.kind !== "to" || parsed.code !== "92" || !isSimple(parsed) || parsed.variant !== undefined || !inline) return undefined
  return refuse(TO92_INLINE_REFUSAL)
}
