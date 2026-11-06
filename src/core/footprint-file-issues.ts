import { FOOTPRINT_FILE } from "../engine/engine.js"

type Element = Record<string, unknown>

const UNCONNECTED_PORT = "pcb_port_not_connected_error"
const QUOTED = /"([^"]*)"/g

const asElement = (value: unknown): Element =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Element) : {}
const asStrings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [])
const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined)

/** An error that a footprint prop is invalid, where the value is a copperflow footprint file such as parts/J/footprint.yaml. */
function isFootprintFileError(element: Element): boolean {
  const type = text(element["type"]) ?? ""
  const message = text(element["message"]) ?? ""
  if (!type.endsWith("_error") || (element["property_name"] !== "footprint" && !/footprint prop/i.test(message))) return false
  const values = [text(element["property_value"]), ...[...message.matchAll(QUOTED)].map((match) => match[1])]
  return values.some((value) => value !== undefined && FOOTPRINT_FILE.test(value))
}

/** The connectivity keys of the nets that reach one of `components`, read from their source ports. */
function netsReaching(elements: readonly Element[], components: ReadonlySet<string>): Set<string> {
  const keys = elements.flatMap((element) => {
    const component = text(element["source_component_id"])
    const key = text(element["subcircuit_connectivity_map_key"])
    return element["type"] === "source_port" && component !== undefined && components.has(component) && key ? [key] : []
  })
  return new Set(keys)
}

/** The connectivity key of each PCB port, through its source port. */
function netOfPcbPort(elements: readonly Element[]): Map<string, string> {
  const netOfSource = new Map<string, string>()
  for (const element of elements) {
    const id = text(element["source_port_id"])
    const key = text(element["subcircuit_connectivity_map_key"])
    if (element["type"] === "source_port" && id && key) netOfSource.set(id, key)
  }
  const result = new Map<string, string>()
  for (const element of elements) {
    const id = text(element["pcb_port_id"])
    const net = netOfSource.get(text(element["source_port_id"]) ?? "")
    if (element["type"] === "pcb_port" && id && net) result.set(id, net)
  }
  return result
}

/**
 * The circuit JSON without the errors that only say tscircuit cannot read copperflow's footprint
 * files: the invalid footprint prop of such a part, and, since tscircuit then gives the part no
 * pads, the unconnected ports on nets that reach it. Every other error and every warning is kept.
 */
export function withoutFootprintFileErrors(elements: readonly unknown[]): unknown[] {
  const records = elements.map(asElement)
  const unreadable = records.filter(isFootprintFileError)
  if (unreadable.length === 0) return [...elements]
  const components = new Set(unreadable.flatMap((element) => asStrings([element["source_component_id"]])))
  const nets = netsReaching(records, components)
  const portNets = netOfPcbPort(records)
  const followsFromFile = (element: Element): boolean => {
    if (element["type"] !== UNCONNECTED_PORT) return false
    const ports = asStrings(element["pcb_port_ids"])
    return ports.length > 0 && ports.every((port) => nets.has(portNets.get(port) ?? ""))
  }
  return elements.filter((_, i) => {
    const record = records[i] ?? {}
    return !isFootprintFileError(record) && !followsFromFile(record)
  })
}
