import type { ParsedFootprint } from "./parse.js"
import { pinRowFootprint } from "./pinrow.js"
import { isRefusal, refuse, type Footprint, type Refusal } from "./types.js"

/**
 * Pin sockets (female headers) at 2.54 mm, "socket<N>" and "socket2x<N>": the very lands and
 * numbering of "pinrow<N>" and "pinrow2x<N>", made by the pin row family and renamed, so the two can
 * never drift apart.
 */
export function socketFootprint(parsed: ParsedFootprint): Footprint | Refusal | undefined {
  if (parsed.kind !== "socket") return undefined
  if (Object.keys(parsed.params).length > 0) return refuse("pin sockets are 2.54 mm pitch only and take no parameters")
  const made = pinRowFootprint({ ...parsed, kind: "pinrow" })
  if (made === undefined) return refuse("a pin socket is socket<N> or socket2x<N>, such as socket4")
  if (isRefusal(made)) return refuse(made.refused.replaceAll("pinrow", "socket").replaceAll("header", "socket"))
  const name = parsed.cross === undefined ? `socket${parsed.code}` : `socket2x${parsed.cross}`
  return { ...made, name, origin: made.origin.replace(/pin (row|header)/, "pin socket") }
}
