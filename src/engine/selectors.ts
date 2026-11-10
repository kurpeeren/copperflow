export type ParsedSelector = { kind: "net"; name: string } | { kind: "pin"; part: string; pin: string }

/** A net's name, unanchored: ASCII letters, digits, "_" and "-". `net.<name>` selectors and bus members share it. */
export const NET_NAME = /[\w-]+/

const NET = new RegExp(String.raw`^net\.(${NET_NAME.source})$`)
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

const LOCAL_NET = /^net\.((?:[\w-]+(?:~\d+)?\/)+)([\w-]+)$/

/**
 * A net inside a sub-sheet instance as circuit_summary names it, "net.PS1/FB": the instance path and the net's name
 * in the sheet. Such a name is not a selector; the net is written in the sheet file.
 */
export function localNet(text: string): { instance: string; net: string } | undefined {
  const match = LOCAL_NET.exec(text.trim())
  return match?.[1] && match[2] ? { instance: match[1].slice(0, -1), net: match[2] } : undefined
}

/** Why a local net cannot be written in the circuit, pointing at the sheet file that holds it, when known. */
export function localNetRefusal(local: { instance: string; net: string }, file: string | undefined): string {
  return `${local.instance}/${local.net} is local to instance ${local.instance}; edit ${file ?? "its sheet file"} and use ${local.net} there`
}
