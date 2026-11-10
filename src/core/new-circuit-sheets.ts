// The sub-sheets of a new circuit: each sheet given is written as `<Name>.sheet.tsx` beside the circuit, and each
// instance becomes an edit of the circuit. Everything is checked before anything is written.
import { posix } from "node:path"
import { Bases, withBase } from "../engine/sheets.js"
import { analyzeCircuit, scanCircuit } from "./analyze.js"
import { applyEdits } from "./edit.js"
import { readIfThere } from "./file-writes.js"
import { SHEET_TAG } from "./instance-edits.js"
import { checkPorts, sheetPorts } from "./instance-requests.js"
import { boardSkeleton, checkNets, checkParts, NET_NAME, PART_NAME, partEdit, type NewPart } from "./netlist.js"
import type { Edit } from "./types.js"
import { resolveInRoot } from "./workspace.js"

export interface NewSheet {
  parts: NewPart[]
  /** Net name to the pins on it inside the sheet; a net named like a port is that port's. */
  nets: Record<string, string[]>
  /** The nets an instance connects to the circuit, in the order the sheet symbol shows them. */
  ports: string[]
}

export interface NewInstance {
  /** A sheet given in the same call, or a `<sheet>.sheet.tsx` beside the circuit. */
  sheet: string
  name: string
  /** Port name to the circuit's net name. */
  connections: Record<string, string>
  base?: number
}

/** What an instance needs to know of its sheet. */
interface SheetFacts {
  ports: string[]
  /** The local names of the sheet's own parts. */
  parts: string[]
}

/** The edits that place the instances and the sheet files to write with the circuit. */
export interface PlannedSheets {
  files: { file: string; text: string }[]
  instances: Extract<Edit, { kind: "addInstance" }>[]
}

const ANY_SIZE = { width: 10, height: 10 }

function prefixed<T>(name: string, task: () => T): T {
  try {
    return task()
  } catch (error) {
    throw new Error(`${name}: ${(error as Error).message}`)
  }
}

function checkSheetName(name: string): void {
  if (!SHEET_TAG.test(name)) throw new Error(`"${name}" is not a sheet name; a sheet name starts with a capital letter, e.g. PowerStage`)
}

function checkSheetPorts(name: string, ports: readonly string[]): void {
  const seen = new Set<string>()
  for (const port of ports) {
    if (!NET_NAME.test(port)) throw new Error(`${name}: "${port}" is not a port name; use letters, digits, _ and -`)
    if (seen.has(port)) throw new Error(`${name}: the port ${port} is written twice`)
    seen.add(port)
  }
}

/** A board file's body re-written as a sheet: the same imports, a function named after the sheet returning `<sheet>` with the ports first. */
function asSheet(text: string, name: string, ports: readonly string[]): string {
  const lines = text.split("\n")
  const exported = lines.findIndex((line) => line.startsWith("export default"))
  const open = lines.findIndex((line) => line.trimStart().startsWith("<board"))
  const close = lines.findIndex((line) => line.trim() === "</board>")
  const body = lines.slice(open + 1, close).map((line) => `  ${line}`)
  const portLines = ports.map((port) => `      <port name="${port}" />`)
  return [...lines.slice(0, exported), `export default function ${name}() {`, "  return (", "    <sheet>", ...portLines, ...body, "    </sheet>", "  )", "}", ""].join("\n")
}

/** The text of a sheet file, or throws, naming the sheet, why it cannot be written. */
async function sheetText(root: string, file: string, name: string, sheet: NewSheet): Promise<string> {
  checkSheetName(name)
  checkSheetPorts(name, sheet.ports)
  if (sheet.parts.length === 0) throw new Error(`${name}: a sheet needs at least one part`)
  const { table, props } = await checkParts(root, sheet.parts).catch((error: Error) => Promise.reject(new Error(`${name}: ${error.message}`)))
  const nets = prefixed(name, () => checkNets(table, sheet.nets))
  const skeleton = boardSkeleton(ANY_SIZE)
  const circuit = { file, model: analyzeCircuit(skeleton) }
  const edits: Edit[] = []
  for (const part of sheet.parts) edits.push(await partEdit(root, circuit, part, props.get(part.name) ?? { props: {} }, undefined))
  for (const [net, selectors] of nets) for (const from of selectors) edits.push({ kind: "addTrace", from, to: `net.${net}` })
  return asSheet(applyEdits(skeleton, edits, new Set()), name, sheet.ports)
}

/** The ports and parts of a sheet file already in the project, or undefined when there is none. */
async function existingSheet(root: string, file: string): Promise<SheetFacts | undefined> {
  const text = await readIfThere(resolveInRoot(root, file))
  if (text === undefined) return undefined
  const parts = scanCircuit(text).model.parts.filter((part) => part.tag !== "port" && !SHEET_TAG.test(part.tag)).map((part) => part.name)
  return { ports: sheetPorts(text), parts }
}

function checkConnections(instance: NewInstance, sheet: SheetFacts): void {
  prefixed(instance.name, () => checkPorts(instance.sheet, sheet.ports, instance.connections))
  for (const [port, net] of Object.entries(instance.connections)) {
    if (typeof net !== "string" || !NET_NAME.test(net)) throw new Error(`${instance.name}: connections.${port} must be a net name such as "VBUS"`)
  }
  if (instance.base !== undefined && !(Number.isInteger(instance.base) && instance.base > 0)) {
    throw new Error(`${instance.name}: base must be a whole number above 0, such as 300`)
  }
}

/** Each instance's base, as the engine gives them, refused when two instances take one base or a designator twice. */
function checkBases(instances: readonly NewInstance[], sheets: ReadonlyMap<string, SheetFacts>, partNames: readonly string[]): Map<string, number> {
  const bases = new Bases()
  const made = new Map<string, string>(partNames.map((name) => [name, ""]))
  const result = new Map<string, number>()
  for (const instance of instances) {
    const { base, clashWith } = bases.claim("", instance.name, instance.base)
    if (clashWith !== undefined) throw new Error(`${instance.name}: base ${base} is already ${clashWith}'s; give another base`)
    bases.finish("", instance.name, base, instance.base !== undefined)
    result.set(instance.name, base)
    for (const local of sheets.get(instance.sheet)?.parts ?? []) {
      const id = withBase(local, base)
      const owner = made.get(id)
      if (owner === "") throw new Error(`${instance.name} makes ${id} (${local} in ${instance.sheet}), which is also a part of the circuit; give ${instance.name} another base`)
      if (owner !== undefined) throw new Error(`${instance.name} makes ${id} (${local} in ${instance.sheet}), which ${owner} makes too; give ${instance.name} another base`)
      made.set(id, instance.name)
    }
  }
  return result
}

/**
 * The sheet files and instance edits of a new circuit (`file`, project-relative with `/`), checked: sheet names,
 * ports and netlists; instance names against the circuit's parts, sheets, ports, connections and bases. Writes nothing.
 */
export async function planSheets(
  root: string,
  file: string,
  spec: { sheets?: Record<string, NewSheet>; instances?: NewInstance[] },
  partNames: readonly string[],
): Promise<PlannedSheets> {
  const folder = posix.dirname(file)
  const sheetFile = (name: string) => posix.join(folder, `${name}.sheet.tsx`)
  const files: PlannedSheets["files"] = []
  const facts = new Map<string, SheetFacts>()
  for (const [name, sheet] of Object.entries(spec.sheets ?? {})) {
    files.push({ file: sheetFile(name), text: await sheetText(root, sheetFile(name), name, sheet) })
    facts.set(name, { ports: sheet.ports, parts: sheet.parts.map((part) => part.name) })
  }
  const names = new Set(partNames)
  const instances = spec.instances ?? []
  for (const instance of instances) {
    if (!PART_NAME.test(instance.name)) throw new Error(`"${instance.name}" is not a valid instance name; use letters, digits and _, starting with a letter, e.g. PS1`)
    if (names.has(instance.name)) throw new Error(`Two parts or instances are named ${instance.name}; names must be unique`)
    names.add(instance.name)
    checkSheetName(instance.sheet)
    const sheet = facts.get(instance.sheet) ?? (await existingSheet(root, sheetFile(instance.sheet)))
    if (!sheet) {
      const given = [...facts.keys()].join(", ") || "none"
      throw new Error(`${instance.name}: there is no sheet ${instance.sheet}; the sheets are ${given} (or write ${instance.sheet}.sheet.tsx first)`)
    }
    facts.set(instance.sheet, sheet)
    checkConnections(instance, sheet)
  }
  // Every base is written, so the designators stay what they are checked to be here wherever an instance is moved.
  const bases = checkBases(instances, facts, partNames)
  const edits = instances.map((instance): PlannedSheets["instances"][number] => ({
    kind: "addInstance",
    tag: instance.sheet,
    name: instance.name,
    connections: instance.connections,
    base: bases.get(instance.name) ?? instance.base ?? 0,
    importFrom: `./${instance.sheet}.sheet`,
  }))
  return { files, instances: edits }
}
