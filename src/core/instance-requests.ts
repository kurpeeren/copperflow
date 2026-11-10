// The requests that make instance edits: a sheet's file and ports are read so the connections can be checked.
import { readFile } from "node:fs/promises"
import { posix } from "node:path"
import { scanCircuit } from "./analyze.js"
import { SHEET_IMPORT, SHEET_TAG } from "./instance-edits.js"
import { connectionRefusal } from "./connection-names.js"
import { sheetFileIn } from "./selectors.js"
import { checkNewInstance, nextFreeBase, placeInstances, sheetLayout } from "./sheet-layout.js"
import { resolveInRoot } from "./workspace.js"
import type { CircuitModel, Edit } from "./types.js"

/** The names of a sheet file's bus ports, `<port name bus />`. */
export function sheetBusPorts(text: string): string[] {
  return scanCircuit(text).model.parts.filter((part) => part.tag === "port" && part.props["bus"]?.literal === true).map((part) => part.name)
}

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

async function portsOfFile(root: string, sheet: string, file: string): Promise<{ ports: string[]; buses: string[] }> {
  let text: string
  try {
    text = await readFile(resolveInRoot(root, file), "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`There is no sheet ${sheet}: ${file} does not exist`)
    throw error
  }
  return { ports: sheetPorts(text), buses: sheetBusPorts(text) }
}

/**
 * Refuses a connection to a port the sheet has not, naming the ones it has, and a connection a port cannot take: a
 * net port takes a net name, a bus port a bus name, and neither a net local to an instance.
 */
export function checkPorts(sheet: string, ports: readonly string[], connections: Record<string, string>, buses?: readonly string[]): void {
  const unknown = Object.keys(connections).find((port) => !ports.includes(port))
  if (unknown !== undefined) throw new Error(`${sheet} has no port ${unknown}; ${ports.length === 0 ? "it has no ports" : `its ports are ${ports.join(", ")}`}`)
  // Without the sheet's bus ports (a sheet new_circuit is writing has none), its own checks name the nets.
  if (buses === undefined) return
  for (const [port, target] of Object.entries(connections)) {
    const refusal = connectionRefusal(sheet, port, target, buses.includes(port))
    if (refusal !== undefined) throw new Error(refusal)
  }
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
 * The edit that adds an instance, checked as new_circuit checks one: the connections against the sheet file's ports,
 * the base and the designators it makes against the circuit's parts and instances. Without a base it is written
 * past every instance's span, so its designators stay put when instances are moved or reordered; when an instance
 * of the circuit takes the default base, the new one does too (the default then depends on the order written, and
 * the engine's defaults never collide). Writes nothing.
 */
export async function instanceEdit(root: string, circuit: { file: string; model: CircuitModel }, request: InstanceRequest): Promise<Edit> {
  if (!SHEET_TAG.test(request.sheet)) throw new Error(`"${request.sheet}" is not a sheet name; a sheet name starts with a capital letter, e.g. PowerStage`)
  const { file, importFrom } = sheetFileFor(circuit, request.sheet)
  const sheetPortsRead = await portsOfFile(root, request.sheet, file)
  checkPorts(request.sheet, sheetPortsRead.ports, request.connections, sheetPortsRead.buses)
  const placed = await placeInstances(root, circuit.file, circuit.model)
  const base = request.base ?? (placed.every((instance) => instance.written) ? nextFreeBase(placed) : undefined)
  if (base !== undefined) {
    const parts = circuit.model.parts.filter((part) => sheetFileIn(circuit.model, part.name) === undefined).map((part) => part.name)
    checkNewInstance(request.name, request.sheet, base, await sheetLayout(root, file, [circuit.file]), placed, parts)
  }
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
  const read = await portsOfFile(root, tag, file)
  checkPorts(tag, read.ports, request.connections, read.buses)
  return { kind: "setConnections", part: request.instance, connections: request.connections }
}
