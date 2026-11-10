// Edits of sub-sheets: in a sheet file, a port renamed with its local net and the symbol's size on `<sheet>`; in a
// circuit, an instance's `connections`. A port's side, order and bus flag are ordinary props (setProps on the port).
import MagicString from "magic-string"
import { busMembers } from "../engine/drawing-kinds.js"
import { NET_NAME } from "../engine/selectors.js"
import type { Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { attributeNamed, putAttribute } from "./edit-text.js"
import { formatLiteral } from "./literals.js"
import type { PartInfo } from "./types.js"

const WHOLE_NET_NAME = new RegExp(`^${NET_NAME.source}$`)
/** A key an object literal may write bare: VIN, D0; anything else ("D[0:7]") is quoted. */
const BARE_KEY = /^[A-Za-z_$][\w$]*$/
const LARGEST_SIZE = 1000

function portOrThrow(scan: Scan, name: string): PartInfo {
  const port = scan.model.parts.find((part) => part.name === name && part.tag === "port")
  if (!port) throw new EditError("not_found", `No port named ${name} in this sheet`)
  if (!port.editable) throw new EditError("readonly", `Port ${name} is read-only (${port.readonlyReason})`)
  return port
}

/** Whether a name is usable for a port: a net name, or for a bus port a bus name such as "D[0:7]". */
function portNameOk(name: string, bus: boolean): boolean {
  return bus ? busMembers(name) !== undefined : WHOLE_NET_NAME.test(name)
}

/**
 * Renames a port and the sheet's local net of that name: the `<port name>` and every trace end written `net.<from>`.
 * The instances in parent circuits keep their `connections`, which name the old port until they are changed.
 */
export function renamePort(source: string, scan: Scan, from: string, to: string): string {
  const port = portOrThrow(scan, from)
  const bus = port.props["bus"]?.literal === true
  if (typeof to !== "string" || !portNameOk(to, bus)) {
    throw new EditError("invalid", `"${String(to)}" is not a ${bus ? 'bus name such as "D[0:7]"' : 'net name; use letters, digits, "_" and "-"'}`)
  }
  if (to === from) throw new EditError("invalid", `The port is already named ${to}`)
  if (scan.model.parts.some((part) => part.name === to)) throw new EditError("invalid", `${to} is already the name of a part or port in this sheet`)
  const node = scan.partNodes.get(from)
  if (!node) throw new EditError("not_found", `No port named ${from} in this sheet`)
  const out = new MagicString(source)
  putAttribute(out, source, node, "name", formatLiteral(to))
  scan.model.traces.forEach((trace, index) => {
    const element = scan.traceNodes[index]
    if (!element) return
    for (const key of ["from", "to"] as const) {
      if (trace[key] !== `net.${from}`) continue
      if (!trace.editable) throw new EditError("readonly", `The trace on line ${trace.line} names net.${from} and is read-only; rename it by hand`)
      putAttribute(out, source, element, key, formatLiteral(`net.${to}`))
    }
  })
  return out.toString()
}

/** Sets the sheet symbol's size on `<sheet>`: each a number above 0; null removes it, so the ports decide it again. */
export function setSheetSize(source: string, scan: Scan, size: { width?: number | null; height?: number | null }): string {
  const node = scan.sheetNode
  if (!node) throw new EditError("invalid", "This file has no <sheet>; only a sheet file has a symbol size")
  const out = new MagicString(source)
  for (const key of ["width", "height"] as const) {
    const value = size[key]
    if (value === undefined) continue
    const attribute = attributeNamed(source, node, key)
    if (value === null) {
      if (attribute) out.remove((attribute.start ?? 1) - 1, attribute.end ?? 0)
      continue
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > LARGEST_SIZE) {
      throw new EditError("invalid", `${key} must be a number above 0 and at most ${LARGEST_SIZE}`)
    }
    putAttribute(out, source, node, key, formatLiteral(Math.round(value * 1000) / 1000))
  }
  return out.toString()
}

/** `{{ VIN: "VBUS", "D[0:7]": "D[0:7]" }}`: the connections as an object literal, in the order given. */
function formatConnections(connections: Readonly<Record<string, string>>): string {
  const entries = Object.entries(connections).map(([port, net]) => `${BARE_KEY.test(port) ? port : JSON.stringify(port)}: ${JSON.stringify(net)}`)
  return entries.length === 0 ? "{{}}" : `{{ ${entries.join(", ")} }}`
}

/**
 * Writes an instance's `connections` whole: each port to a parent net name (a bus port to a parent bus name). The
 * engine reports a port the sheet lacks; here each entry must at least be a usable name.
 */
export function setConnections(source: string, scan: Scan, part: PartInfo, connections: Readonly<Record<string, string>>): string {
  if (typeof connections !== "object" || connections === null || Array.isArray(connections)) {
    throw new EditError("invalid", "connections must be an object such as { VIN: \"VBUS\" }")
  }
  for (const [port, net] of Object.entries(connections)) {
    if (busMembers(port) === undefined) throw new EditError("invalid", `"${port}" is not a port name`)
    const bare = typeof net === "string" ? net.replace(/^net\./, "") : undefined
    if (bare === undefined || busMembers(bare) === undefined) throw new EditError("invalid", `connections.${port} must be a net name such as "VBUS"`)
  }
  const node = scan.partNodes.get(part.name)
  if (!node) throw new EditError("not_found", `No instance named ${part.name}`)
  const out = new MagicString(source)
  putAttribute(out, source, node, "connections", formatConnections(connections))
  return out.toString()
}
