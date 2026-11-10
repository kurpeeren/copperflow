// Sub-sheets: a `<name>.sheet.tsx` file exports a component that returns `<sheet>`, and each use of it in a circuit
// is an instance flattened into the circuit. These are the rules the flattening follows; elaborate.ts walks the tree.
import { posix } from "node:path"
import { diagnostic } from "./diagnostics.js"
import { isElement, type CfElement } from "./jsx-runtime.js"
import type { Diagnostic, SourceRef } from "./model.js"
import { naturalCompare } from "./order.js"
import { labelStyle } from "./schematic-nets.js"
import { NET_NAME } from "./selectors.js"
import type { TraceScope } from "./traces.js"

export const SHEET_FILE = /\.sheet\.tsx$/
/** Bases go up in steps of this much in the order the instances are written: 100, 200, … */
export const BASE_STEP = 100

const WHOLE_NET_NAME = new RegExp(`^${NET_NAME.source}$`)
const TRAILING_NUMBER = /^(.*?)(\d+)$/

/** The sheet's name: its file name without ".sheet.tsx". */
export const sheetName = (file: string): string => posix.basename(file).replace(SHEET_FILE, "")

/** A designator with the base added to its number: R1 with base 100 is R101; a name without a number gets the base appended. */
export function withBase(name: string, base: number): string {
  const match = TRAILING_NUMBER.exec(name)
  return match ? `${match[1] ?? ""}${Number(match[2]) + base}` : `${name}${base}`
}

/** One instance as the walk inside it sees it. */
export interface InstanceScope {
  name: string
  path: string
  sheet: string
  /** The sum of the bases from the circuit down: what every designator inside gets added. */
  base: number
  /** The sheet files from the circuit down to this one, so a sheet that contains itself is caught. */
  files: readonly string[]
  parent: InstanceScope | undefined
  ports: readonly string[]
  /** Port name to the parent's net name, for the ports the instance connects. */
  connections: ReadonlyMap<string, string>
  /** Local part name to flattened id, filled as the parts are made. */
  parts: Map<string, string>
}

/**
 * The flattened name of net `name` written inside `scope`: a connected port's net is the parent's net, a power or
 * ground name is global, any other net is the instance's own, "<path>/<name>".
 */
export function flatNet(scope: InstanceScope | undefined, name: string): string {
  if (!scope) return name
  const parentNet = scope.connections.get(name)
  if (parentNet !== undefined) return flatNet(scope.parent, parentNet)
  return labelStyle(name) === "label" ? `${scope.path}/${name}` : name
}

/** How a trace inside the instance names parts and nets; a part the sheet has not keeps a name no part has. */
export function traceScope(scope: InstanceScope): TraceScope {
  return { part: (name) => scope.parts.get(name) ?? `${scope.path}/${name}`, net: (name) => flatNet(scope, name) }
}

/** The names of the `<port>` elements a sheet holds, in the order written, each once. Components inside are not entered. */
export function portsOf(children: readonly unknown[]): string[] {
  const names: string[] = []
  const walk = (nodes: readonly unknown[]): void => {
    for (const node of nodes) {
      if (!isElement(node) || typeof node.type !== "string") continue
      const name = node.props["name"]
      if (node.type === "port" && typeof name === "string" && WHOLE_NET_NAME.test(name) && !names.includes(name)) names.push(name)
      walk(node.children)
    }
  }
  walk(children)
  return names
}

/** A port whose name is not a net name, so no trace can reach it. */
export function badPorts(children: readonly unknown[], source: (element: CfElement) => SourceRef): Diagnostic[] {
  const found: Diagnostic[] = []
  const walk = (nodes: readonly unknown[]): void => {
    for (const node of nodes) {
      if (!isElement(node) || typeof node.type !== "string") continue
      const name = node.props["name"]
      if (node.type === "port" && (typeof name !== "string" || !WHOLE_NET_NAME.test(name))) {
        const message = `<port> needs a name made of letters, digits, "_" and "-"; it is ignored`
        found.push(diagnostic("bad-value", "error", message, ["port"], source(node)))
      }
      walk(node.children)
    }
  }
  walk(children)
  return found
}

export interface InstanceSpec {
  name: string
  sheet: string
  ports: readonly string[]
  source: SourceRef
}

/** The connections an instance writes: each port to a parent net name, "net." allowed in front. Bad entries are errors and left out. */
export function readConnections(value: unknown, spec: InstanceSpec): { connections: Map<string, string>; diagnostics: Diagnostic[] } {
  const connections = new Map<string, string>()
  const diagnostics: Diagnostic[] = []
  const error = (code: string, message: string, item: string) => diagnostics.push(diagnostic(code, "error", message, [item], spec.source))
  if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value))) {
    error("bad-value", `${spec.name}: connections must be an object such as { VIN: "VBUS" }`, `${spec.name}.connections`)
  }
  const entries = typeof value === "object" && value !== null && !Array.isArray(value) ? Object.entries(value) : []
  for (const [port, target] of entries) {
    const net = typeof target === "string" ? target.replace(/^net\./, "") : undefined
    if (!spec.ports.includes(port)) {
      const known = [...spec.ports].sort(naturalCompare).join(", ")
      error("unknown-port", `${spec.sheet} has no port ${port} (${known === "" ? "it has no ports" : `ports: ${known}`})`, `${spec.name}.${port}`)
    } else if (net === undefined || !WHOLE_NET_NAME.test(net)) {
      error("bad-value", `${spec.name}: connections.${port} must be a net name such as "VBUS"`, `${spec.name}.${port}`)
    } else connections.set(port, net)
  }
  for (const port of spec.ports) {
    if (connections.has(port) || entries.some(([key]) => key === port)) continue
    const message = `Port ${port} of ${spec.name} (${spec.sheet}) is not connected`
    diagnostics.push(diagnostic("unconnected-port", "warning", message, [`${spec.name}.${port}`], spec.source))
  }
  return { connections, diagnostics }
}

/** The base an instance writes, when it is a whole number above zero; anything else is an error and the default is used. */
export function readBase(value: unknown, name: string, source: SourceRef): { base?: number; diagnostics: Diagnostic[] } {
  if (value === undefined) return { diagnostics: [] }
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return { base: value, diagnostics: [] }
  const message = `${name}: base must be a whole number above 0, such as 300; the default is used`
  return { diagnostics: [diagnostic("bad-value", "error", message, [`${name}.base`], source)] }
}
