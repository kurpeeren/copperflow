// Which chips stand where, from the netlist and the pin sides alone: connectors go to a column at the left or
// right edge, the other chips into a grid between them, those that share nets next to each other.
import type { Circuit, Component, Pin, PinType, Side } from "./model.js"
import { naturalCompare } from "./order.js"
import { isConnector } from "./pcb-place/roles.js"
import { flowLayers, type Netlist } from "./schematic-place-plan.js"
import type { SchSymbol } from "./symbols/index.js"

type Symbols = ReadonlyMap<string, SchSymbol>
export type Edge = "left" | "right"

/** The chips in reading order, and the connectors at each edge. */
export interface Arrangement {
  core: Component[]
  left: Component[]
  right: Component[]
}

/** A pin and the part it belongs to. */
export interface Member {
  part: string
  pin: Pin
}

/** The pins on each net, by net id. */
export type Members = ReadonlyMap<string, readonly Member[]>

const DRIVES: ReadonlySet<PinType> = new Set(["output", "power_out"])
const TAKES: ReadonlySet<PinType> = new Set(["input", "power_in"])
/** A connector by its reference: J, P, CN or CON and a number. */
const CONNECTOR_NAME = /^(?:J|P|CN|CON)\d+$/i

/** The last segment of a part's path: "CH1/J1" is a J1. */
const ownName = (id: string): string => id.slice(id.lastIndexOf("/") + 1)

/** A connector by its kind, its footprint or its reference. */
export const isEdgeConnector = (component: Component): boolean => isConnector(component) || CONNECTOR_NAME.test(ownName(component.id))

/** The pins on each net, in the circuit's order. */
export function membersByNet(circuit: Circuit, netlist: Netlist): Map<string, Member[]> {
  const byNet = new Map<string, Member[]>()
  for (const component of circuit.components) {
    for (const pin of component.pins) {
      const net = netlist.netOf.get(pin.id)
      if (net === undefined) continue
      const list = byNet.get(net)
      if (list) list.push({ part: component.id, pin })
      else byNet.set(net, [{ part: component.id, pin }])
    }
  }
  return byNet
}

const sideOf = (symbols: Symbols, part: string, pin: Pin): Side | undefined => symbols.get(part)?.pins.find((p) => p.number === pin.number)?.side

/** The connector's pins on nets other than ground, each with the chip pins it meets there. */
function contactsOf(connector: Component, chips: ReadonlySet<string>, netlist: Netlist, byNet: Members): { own: Pin; others: Member[] }[] {
  return connector.pins.flatMap((own) => {
    const net = netlist.netOf.get(own.id)
    if (net === undefined || netlist.kindOf.get(net) === "ground") return []
    return [{ own, others: (byNet.get(net) ?? []).filter((member) => chips.has(member.part)) }]
  })
}

/**
 * The edge a connector stands at. Inputs go left and outputs right, as the pin types say: its own pins that drive
 * and the chip pins that take from it make it an input. When the types say nothing, it stands where the chip pins
 * it meets face, so that their wires leave towards it; failing that, where its own pins face away from.
 */
export function edgeOf(connector: Component, chips: ReadonlySet<string>, symbols: Symbols, netlist: Netlist, byNet: Members): Edge {
  let flow = 0
  let facing = 0
  let own = 0
  for (const contact of contactsOf(connector, chips, netlist, byNet)) {
    flow += (DRIVES.has(contact.own.type) ? 1 : 0) - (TAKES.has(contact.own.type) ? 1 : 0)
    const ownSide = sideOf(symbols, connector.id, contact.own)
    own += ownSide === "right" ? 1 : ownSide === "left" ? -1 : 0
    for (const other of contact.others) {
      flow += (TAKES.has(other.pin.type) ? 1 : 0) - (DRIVES.has(other.pin.type) ? 1 : 0)
      const side = sideOf(symbols, other.part, other.pin)
      facing += side === "left" ? 1 : side === "right" ? -1 : 0
    }
  }
  const lean = flow !== 0 ? flow : facing !== 0 ? facing : own
  return lean < 0 ? "right" : "left"
}

/** How strongly each pair of chips is tied: each signal net they share counts 1/(pins on it - 1). */
function affinities(chips: ReadonlySet<string>, netlist: Netlist, byNet: Members): Map<string, Map<string, number>> {
  const ties = new Map<string, Map<string, number>>()
  const add = (a: string, b: string, weight: number): void => {
    const row = ties.get(a) ?? new Map<string, number>()
    row.set(b, (row.get(b) ?? 0) + weight)
    ties.set(a, row)
  }
  for (const [net, members] of byNet) {
    if (netlist.kindOf.get(net) !== "signal" || members.length < 2) continue
    const parts = [...new Set(members.map((member) => member.part).filter((part) => chips.has(part)))]
    const weight = 1 / (members.length - 1)
    for (const a of parts) for (const b of parts) if (a !== b) add(a, b, weight)
  }
  return ties
}

/**
 * The chips in reading order: by signal flow first, and within one step of the flow each next to the chip it shares
 * the most with, the one placed last first, then all placed so far; ties by name.
 */
export function coreOrder(chips: readonly Component[], netlist: Netlist, byNet: Members): Component[] {
  const byName = new Map(chips.map((chip) => [chip.id, chip]))
  const layers = flowLayers(chips, netlist)
  const ties = affinities(new Set(byName.keys()), netlist, byNet)
  const tie = (a: string | undefined, b: string): number => (a === undefined ? 0 : (ties.get(a)?.get(b) ?? 0))
  const order: string[] = []
  const steps = [...new Set(layers.values())].sort((a, b) => a - b)
  for (const step of steps) {
    const left = [...byName.keys()].filter((name) => layers.get(name) === step).sort(naturalCompare)
    while (left.length > 0) {
      const last = order[order.length - 1]
      const score = (name: string): [number, number] => [tie(last, name), order.reduce((sum, placed) => sum + tie(placed, name), 0)]
      let best = 0
      for (let i = 1; i < left.length; i++) {
        const [a, b] = [score(left[i] as string), score(left[best] as string)]
        if (a[0] > b[0] + 1e-9 || (Math.abs(a[0] - b[0]) <= 1e-9 && a[1] > b[1] + 1e-9)) best = i
      }
      order.push(...left.splice(best, 1))
    }
  }
  return order.flatMap((name) => byName.get(name) ?? [])
}

/** The chips in reading order and the connectors at their edges, each column in name order. */
export function arrangementOf(anchors: readonly Component[], symbols: Symbols, netlist: Netlist, byNet: Members): Arrangement {
  const connectors = anchors.filter(isEdgeConnector)
  const chips = anchors.filter((anchor) => !isEdgeConnector(anchor))
  const names = new Set(chips.map((chip) => chip.id))
  const edges = new Map(connectors.map((connector) => [connector.id, edgeOf(connector, names, symbols, netlist, byNet)]))
  const byEdge = (edge: Edge): Component[] => connectors.filter((connector) => edges.get(connector.id) === edge).sort((a, b) => naturalCompare(a.id, b.id))
  return { core: coreOrder(chips, netlist, byNet), left: byEdge("left"), right: byEdge("right") }
}

/** Each pin of a connector on a net other than ground, and the chip pins it meets there. */
export function pullsOf(connector: Component, chips: ReadonlySet<string>, netlist: Netlist, byNet: Members): { own: Pin; others: Member[] }[] {
  return contactsOf(connector, chips, netlist, byNet).filter((contact) => contact.others.length > 0)
}
