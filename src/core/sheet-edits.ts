// Edits of sub-sheet files: a port renamed with its local net, and the symbol's size on `<sheet>`. A port's side, order
// and bus flag are ordinary props (setProps on the port); an instance's connections are instance-edits.ts.
import MagicString from "magic-string"
import { busMembers } from "../engine/drawing-kinds.js"
import { NET_NAME } from "../engine/selectors.js"
import type { Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { attributeNamed, putAttribute } from "./edit-text.js"
import { formatLiteral } from "./literals.js"
import type { PartInfo } from "./types.js"

const WHOLE_NET_NAME = new RegExp(`^${NET_NAME.source}$`)
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
 * The nets a rename renames, old name to new: the port's own net, or for a bus port each member to the member in the
 * same place ("D[0:3]" to "A[0:3]" renames D0 to A0 … D3 to A3); a bus name with another member count is refused.
 */
function renamedNets(from: string, to: string, bus: boolean): Map<string, string> {
  if (!bus) return new Map([[from, to]])
  const [before, after] = [busMembers(from) ?? [], busMembers(to) ?? []]
  if (before.length !== after.length) throw new EditError("invalid", `${to} has ${after.length} members and ${from} has ${before.length}; a bus port keeps its member count`)
  return new Map(before.map((member, index) => [member, after[index] as string]))
}

/**
 * Renames a port and the sheet's local net of that name: the `<port name>` and every trace end written `net.<from>`.
 * A bus port renames the sheet's `<bus>` of its name and its members' trace ends too. The instances in parent
 * circuits keep their `connections`, which name the old port until they are changed.
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
  const nets = renamedNets(from, to, bus)
  const out = new MagicString(source)
  putAttribute(out, source, node, "name", formatLiteral(to))
  scan.model.traces.forEach((trace, index) => {
    const element = scan.traceNodes[index]
    if (!element) return
    for (const key of ["from", "to"] as const) {
      const renamed = nets.get(trace[key]?.replace(/^net\./, "") ?? "")
      if (!trace[key]?.startsWith("net.") || renamed === undefined) continue
      if (!trace.editable) throw new EditError("readonly", `The trace on line ${trace.line} names ${trace[key]} and is read-only; rename it by hand`)
      putAttribute(out, source, element, key, formatLiteral(`net.${renamed}`))
    }
  })
  if (bus) renameBuses(out, source, scan, from, to)
  return out.toString()
}

/** Gives every piece of the sheet's `<bus name={from}>` the new name. */
function renameBuses(out: MagicString, source: string, scan: Scan, from: string, to: string): void {
  for (const drawing of scan.model.drawings) {
    if (drawing.tag !== "bus" || drawing.name !== from) continue
    const element = scan.drawingNodes.get(drawing.id)
    if (!drawing.editable || !element) throw new EditError("readonly", `The bus on line ${drawing.line} is read-only; rename it by hand`)
    putAttribute(out, source, element, "name", formatLiteral(to))
  }
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
