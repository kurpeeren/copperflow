const CLASS_SELECTOR = /(?:^|[\s>])\.([A-Za-z_][\w-]*)/
const DOTTED_PORT = /^([A-Za-z_][\w-]*)\.[\w-]+$/

/**
 * Returns the part names referenced by a tscircuit port selector.
 * `.R1 > .pin1` and `R1.pin1` both reference R1; `net.GND` references no part.
 */
export function partsInSelector(selector: string): string[] {
  const names = new Set<string>()
  for (const piece of selector.split(",")) {
    const trimmed = piece.trim()
    if (trimmed.startsWith("net.")) continue
    const match = DOTTED_PORT.exec(trimmed) ?? CLASS_SELECTOR.exec(trimmed)
    if (match?.[1]) names.add(match[1])
  }
  return [...names]
}
