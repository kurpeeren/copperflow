// Edits of sub-sheet instances in a circuit: `<Stage name="S1" connections={{ VIN: "VBUS" }} base={200} />` with
// `import Stage from "./Stage.sheet"`. These check the text; instance-requests.ts checks the sheet file's ports.
import MagicString from "magic-string"
import type { Scan } from "./analyze.js"
import { EditError } from "./edit-error.js"
import { lineEnding, putAttribute } from "./edit-text.js"
import { formatLiteral } from "./literals.js"
import { insertOnPage } from "./page-edits.js"
import type { Edit } from "./types.js"

export const SHEET_TAG = /^[A-Z][A-Za-z0-9_]*$/
const PART_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const NET_NAME = /^[A-Za-z_][\w-]*$/
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/
export const SHEET_IMPORT = /^\.{1,2}\/[\w./-]*\.sheet$/

type AddInstance = Extract<Edit, { kind: "addInstance" }>
type SetConnections = Extract<Edit, { kind: "setConnections" }>

/** `{{ VIN: "VBUS", "V-X": "N" }}`: each port to a parent net name, checked. */
function formatConnections(name: string, connections: Record<string, string>): string {
  const entries = Object.entries(connections).map(([port, net]) => {
    if (!NET_NAME.test(port)) throw new EditError("invalid", `${name}: "${port}" is not a port name`)
    if (typeof net !== "string" || !NET_NAME.test(net)) throw new EditError("invalid", `${name}: connections.${port} must be a net name such as "VBUS"`)
    return `${IDENTIFIER.test(port) ? port : JSON.stringify(port)}: ${JSON.stringify(net)}`
  })
  return entries.length === 0 ? "{{}}" : `{{ ${entries.join(", ")} }}`
}

/** Adds the instance on its page, and `import Tag from "<importFrom>"` when the file has no such import yet. */
export function addInstance(source: string, scan: Scan, edit: AddInstance): string {
  if (!SHEET_TAG.test(edit.tag)) throw new EditError("invalid", `"${edit.tag}" is not a sheet name; a sheet name starts with a capital letter, e.g. PowerStage`)
  if (!PART_NAME.test(edit.name)) throw new EditError("invalid", `"${edit.name}" is not a valid instance name; use letters, digits and _`)
  if (scan.model.parts.some((p) => p.name === edit.name)) throw new EditError("invalid", `A part named ${edit.name} already exists`)
  if (scan.model.drawings.some((d) => d.name === edit.name || d.id === edit.name)) throw new EditError("invalid", `A drawing named ${edit.name} already exists`)
  if (!SHEET_IMPORT.test(edit.importFrom)) throw new EditError("invalid", `"${edit.importFrom}" is not a relative import of a .sheet file`)
  if (edit.base !== undefined && !(Number.isInteger(edit.base) && edit.base > 0)) throw new EditError("invalid", `${edit.name}: base must be a whole number above 0, such as 300`)
  const existing = scan.model.imports.find((spec) => spec.local === edit.tag)
  if (existing && existing.source !== edit.importFrom) throw new EditError("invalid", `${edit.tag} is already imported from "${existing.source}"`)
  const base = edit.base === undefined ? "" : ` base={${edit.base}}`
  const element = `<${edit.tag} name=${formatLiteral(edit.name)} connections=${formatConnections(edit.name, edit.connections)}${base} />`
  const withInstance = insertOnPage(source, scan, element, edit.page, "an instance", true)
  if (existing) return withInstance
  const statement = `import ${edit.tag} from ${JSON.stringify(edit.importFrom)}`
  const lastImport = scan.model.imports.reduce((end, spec) => Math.max(end, spec.end), -1)
  const eol = lineEnding(source)
  return lastImport < 0 ? statement + eol + withInstance : withInstance.slice(0, lastImport) + eol + statement + withInstance.slice(lastImport)
}

/** Writes the instance's `connections` anew; ports left out are open. */
export function setConnections(source: string, scan: Scan, edit: SetConnections, locked: ReadonlySet<string>): string {
  const part = scan.model.parts.find((p) => p.name === edit.part)
  const node = scan.partNodes.get(edit.part)
  if (!part || !node) throw new EditError("not_found", `No part named ${edit.part}`)
  if (locked.has(edit.part)) throw new EditError("locked", `${edit.part} is locked; ask the human to unlock it`)
  if (!part.editable) throw new EditError("readonly", `${edit.part} is read-only (${part.readonlyReason})`)
  const out = new MagicString(source)
  putAttribute(out, source, node, "connections", formatConnections(edit.part, edit.connections))
  return out.toString()
}
