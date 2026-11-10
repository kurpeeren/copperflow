// The requests that make instance edits: a sheet's file and ports are read so the connections can be checked.
import { readFile } from "node:fs/promises"
import { posix } from "node:path"
import { BASE_STEP } from "../engine/sheets.js"
import { scanCircuit } from "./analyze.js"
import { SHEET_IMPORT, SHEET_TAG } from "./instance-edits.js"
import { sheetFileIn } from "./selectors.js"
import { resolveInRoot } from "./workspace.js"
import type { CircuitModel, Edit } from "./types.js"

/** The names of a sheet file's `<port name>` elements, in the order written. */
export function sheetPorts(text: string): string[] {
  return [...new Set(scanCircuit(text).model.parts.filter((part) => part.tag === "port").map((part) => part.name))]
}

/** A sheet's file in the project: the one the circuit imports under that name, else `<name>.sheet.tsx` beside the circuit. */
export function sheetFileFor(circuit: { file: string; model: CircuitModel }, sheet: string): { file: string; importFrom: string } {
  const imported = circuit.model.imports.find((spec) => spec.local === sheet && SHEET_IMPORT.test(spec.source))
  const importFrom = imported?.source ?? `./${sheet}.sheet`
  return { file: posix.join(posix.dirname(circuit.file), `${importFrom}.tsx`), importFrom }
}

async function portsOfFile(root: string, sheet: string, file: string): Promise<string[]> {
  let text: string
  try {
    text = await readFile(resolveInRoot(root, file), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`There is no sheet ${sheet}: ${file} does not exist`)
    throw error
  }
  return sheetPorts(text)
}

/** Refuses a connection to a port the sheet has not, naming the ones it has. */
export function checkPorts(sheet: string, ports: readonly string[], connections: Record<string, string>): void {
  const unknown = Object.keys(connections).find((port) => !ports.includes(port))
  if (unknown !== undefined) throw new Error(`${sheet} has no port ${unknown}; ${ports.length === 0 ? "it has no ports" : `its ports are ${ports.join(", ")}`}`)
}

export interface InstanceRequest {
  /** The sheet's name, e.g. "PowerStage" for PowerStage.sheet.tsx. */
  sheet: string
  name: string
  connections: Record<string, string>
  base?: number
  page?: string
}

/**
 * The base a new instance gets written with: the highest written base of the circuit's instances plus 100, so its
 * designators stay put when instances are moved or reordered. Undefined when an instance takes the default base,
 * since the default then depends on the order written.
 */
function nextBase(model: CircuitModel): number | undefined {
  const bases = model.parts.filter((part) => sheetFileIn(model, part.name) !== undefined).map((part) => part.props["base"]?.literal)
  if (bases.some((base) => typeof base !== "number")) return undefined
  return Math.max(0, ...(bases as number[])) + BASE_STEP
}

/** The edit that adds an instance, with the connections checked against the sheet file's ports. Writes nothing. */
export async function instanceEdit(root: string, circuit: { file: string; model: CircuitModel }, request: InstanceRequest): Promise<Edit> {
  if (!SHEET_TAG.test(request.sheet)) throw new Error(`"${request.sheet}" is not a sheet name; a sheet name starts with a capital letter, e.g. PowerStage`)
  const { file, importFrom } = sheetFileFor(circuit, request.sheet)
  checkPorts(request.sheet, await portsOfFile(root, request.sheet, file), request.connections)
  const base = request.base ?? nextBase(circuit.model)
  return {
    kind: "addInstance",
    tag: request.sheet,
    name: request.name,
    connections: request.connections,
    ...(base === undefined ? {} : { base }),
    importFrom,
    ...(request.page === undefined ? {} : { page: request.page }),
  }
}

/** The edit that sets an instance's connections, checked against its sheet file's ports. Writes nothing. */
export async function connectionsEdit(root: string, circuit: { file: string; model: CircuitModel }, request: { instance: string; connections: Record<string, string> }): Promise<Edit> {
  const sheetFile = sheetFileIn(circuit.model, request.instance)
  if (sheetFile === undefined) throw new Error(`${request.instance} is not a sub-sheet instance`)
  const tag = circuit.model.parts.find((part) => part.name === request.instance)?.tag ?? request.instance
  const file = posix.join(posix.dirname(circuit.file), sheetFile)
  checkPorts(tag, await portsOfFile(root, tag, file), request.connections)
  return { kind: "setConnections", part: request.instance, connections: request.connections }
}
