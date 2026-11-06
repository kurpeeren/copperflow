export type ParsedSelector = { kind: "net"; name: string } | { kind: "pin"; part: string; pin: string }

const NET = /^net\.([\w-]+)$/
const DOTTED = /^([A-Za-z_][\w-]*)\.([\w-]+)$/
const CLASSES = /^\.([A-Za-z_][\w-]*)\s*>\s*\.([\w-]+)$/

/** Understands `net.GND`, `R1.pin1` and `.R1 > .pin1`. Anything else is undefined. */
export function parseSelector(text: string): ParsedSelector | undefined {
  const trimmed = text.trim()
  const net = NET.exec(trimmed)
  if (net?.[1]) return { kind: "net", name: net[1] }
  const pin = CLASSES.exec(trimmed) ?? DOTTED.exec(trimmed)
  return pin?.[1] && pin[2] ? { kind: "pin", part: pin[1], pin: pin[2] } : undefined
}
