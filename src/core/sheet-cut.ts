// Cutting a selection of parts out of a circuit into a sub-sheet, read from the file alone: which wires move with the
// parts, which nets cross the selection's boundary (each becomes a port named after the net, and a crossing bus a bus
// port with the bus's members), what the parent writes to keep those nets joined, and the parts' local designators.
// Pure: the tests run it without a file system or a DOM.
import { busMembers } from "../engine/drawing-kinds.js"
import { naturalCompare, sortedNatural } from "../engine/order.js"
import { parseSelector } from "../engine/selectors.js"
import { sheetFileIn } from "./selectors.js"
import type { CircuitModel, PartInfo, TraceInfo } from "./types.js"

/** A port the new sheet gets: a net port named after the parent net, or a bus port named after the parent bus. */
export interface CutPort {
  name: string
  bus?: true
}

/** A trace one side writes to keep a crossing net joined: a pin to the port's net. */
export interface PinToNet {
  pin: string
  net: string
  /** The page of the pin's part on the parent; absent on Main. */
  page?: string
}

export interface CutPlan {
  /** The page the selection is on; absent on Main. */
  page?: string
  /** The selected parts, in the order the file writes them. */
  parts: PartInfo[]
  /** The ports in name order; each connects to the parent net or bus of the same name. */
  ports: CutPort[]
  connections: Record<string, string>
  /** Each part's designator now and in the sheet, in natural order of the designators now. */
  mapping: { from: string; to: string }[]
  /** The wires among the selected parts (their pins to each other and to nets), which move into the sheet. */
  moved: TraceInfo[]
  /** The parent's new traces: each pin outside that a removed wire joined to a crossing net, to that net. */
  parentTraces: PinToNet[]
  /** The sheet's new traces: each pin inside that a removed wire joined to a crossing net, to the port's net. */
  sheetTraces: PinToNet[]
  /** A moved wire's net end renamed: a net of a crossing net written under another of its names takes the port's net. */
  netNames: ReadonlyMap<string, string>
}

const TRAILING_NUMBER = /^(.*?)(\d+)$/
/** A net name a selector can write, as netlist.ts checks it (this module stays free of the file system for the Studio). */
const NET_NAME = /^[A-Za-z_][\w-]*$/

/** Why the selection cannot become a sub-sheet, or undefined when it can. */
export function cutRefusal(model: CircuitModel, names: readonly string[]): string | undefined {
  if (names.length === 0) return "Select the parts to move into the sub-sheet first."
  const parts: PartInfo[] = []
  for (const name of new Set(names)) {
    const part = model.parts.find((p) => p.name === name)
    if (!part) return `There is no part ${name} in the circuit.`
    if (sheetFileIn(model, name) !== undefined) return `${name} is a sub-sheet instance; a sub-sheet is made of parts only, so leave instances out of the selection.`
    if (!part.editable) return `${name} cannot be moved (${part.readonlyReason ?? "read-only"}).`
    parts.push(part)
  }
  const pages = new Set(parts.map((part) => part.page ?? ""))
  if (pages.size > 1) return "The selected parts are on different pages; select parts of one page."
  return undefined
}

/** A pin or net end as a graph node: "pin:R1.pin1", "net:VIN"; a selector it cannot read is its own node. */
function nodeOf(end: string): string {
  const parsed = parseSelector(end)
  if (!parsed) return `raw:${end.trim()}`
  return parsed.kind === "net" ? `net:${parsed.name}` : `pin:${parsed.part}.${parsed.pin}`
}

const partOfNode = (node: string): string | undefined => (node.startsWith("pin:") ? node.slice(4).split(".")[0] : undefined)

class Groups {
  private readonly parent = new Map<string, string>()
  find(node: string): string {
    let root = node
    while (this.parent.has(root) && this.parent.get(root) !== root) root = this.parent.get(root) as string
    if (!this.parent.has(node)) this.parent.set(node, node)
    return root
  }
  join(a: string, b: string): void {
    const [ra, rb] = [this.find(a), this.find(b)]
    if (ra !== rb) this.parent.set(ra, rb)
  }
  members(): Map<string, string[]> {
    const groups = new Map<string, string[]>()
    for (const node of this.parent.keys()) {
      const root = this.find(node)
      groups.set(root, [...(groups.get(root) ?? []), node])
    }
    return groups
  }
}

const endsOf = (trace: TraceInfo): string[] => [trace.from, trace.to].flatMap((end) => (end === undefined ? [] : [end]))

/** The nets other instances of the circuit connect to, read from their `connections`, each bus as its members. */
function instanceNets(model: CircuitModel): Set<string> {
  const nets = new Set<string>()
  for (const part of model.parts) {
    if (sheetFileIn(model, part.name) === undefined) continue
    for (const match of (part.props["connections"]?.source ?? "").matchAll(/:\s*["']([^"']+)["']/g)) {
      for (const member of busMembers((match[1] ?? "").replace(/^net\./, "")) ?? []) nets.add(member)
    }
  }
  return nets
}

/** The local designators: unchanged, or numbered from 1 within each prefix in natural order of the designators now. */
export function localDesignators(names: readonly string[], rename: boolean): { from: string; to: string }[] {
  const sorted = [...names].sort(naturalCompare)
  if (!rename) return sorted.map((name) => ({ from: name, to: name }))
  const counters = new Map<string, number>()
  return sorted.map((name) => {
    const prefix = TRAILING_NUMBER.exec(name)?.[1]
    if (prefix === undefined) return { from: name, to: name }
    const next = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, next)
    return { from: name, to: `${prefix}${next}` }
  })
}

/** A name for a crossing net that has none: its first pin's, "R5_pin1", made unique among the circuit's nets. */
function unnamedNet(pins: readonly string[], taken: Set<string>): string {
  const first = (sortedNatural(pins)[0] ?? "N").replace(/\./g, "_")
  const base = NET_NAME.test(first) ? first : `N_${first.replace(/[^\w-]/g, "_")}`
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
  taken.add(name)
  return name
}

/** The bus drawn on the circuit that has this net as a member, if any (the first one written). */
function busOf(model: CircuitModel, net: string): string | undefined {
  return model.drawings.find((d) => d.tag === "bus" && d.name !== undefined && (busMembers(d.name) ?? []).includes(net))?.name
}

/**
 * How the selected parts (`cutRefusal` passed) leave the circuit: the ports, connections and designators of the new
 * sheet, the wires that move, and the traces each side writes so every net crossing the boundary stays joined.
 */
export function planCut(model: CircuitModel, names: readonly string[], rename: boolean): CutPlan {
  const inside = new Set(names)
  const parts = model.parts.filter((part) => inside.has(part.name))
  const partsOf = (trace: TraceInfo) => endsOf(trace).flatMap((end) => partOfNode(nodeOf(end)) ?? [])
  const touches = (trace: TraceInfo) => partsOf(trace).some((part) => inside.has(part))
  const moved = model.traces.filter((t) => touches(t) && partsOf(t).every((part) => inside.has(part)))
  const crossing = model.traces.filter((t) => touches(t) && !moved.includes(t))

  const groups = new Groups()
  for (const trace of model.traces) {
    const [a, b] = endsOf(trace).map(nodeOf)
    if (a !== undefined) groups.find(a)
    if (a !== undefined && b !== undefined) groups.join(a, b)
  }
  const usedOutside = instanceNets(model)
  const taken = new Set([...groups.members().values()].flat().filter((node) => node.startsWith("net:")).map((node) => node.slice(4)))
  const portNet = new Map<string, string>()
  const netNames = new Map<string, string>()
  const ports = new Map<string, CutPort>()
  for (const nodes of groups.members().values()) {
    const pinParts = nodes.map(partOfNode).filter((part): part is string => part !== undefined)
    const nets = sortedNatural(nodes.filter((node) => node.startsWith("net:")).map((node) => node.slice(4)))
    const crosses = pinParts.some((part) => inside.has(part)) && (pinParts.some((part) => !inside.has(part)) || nets.some((net) => usedOutside.has(net)))
    if (!crosses) continue
    const bus = nets.map((net) => ({ net, bus: busOf(model, net) })).find((found) => found.bus !== undefined)
    const net = bus?.net ?? nets[0] ?? unnamedNet(nodes.filter((node) => node.startsWith("pin:")).map((node) => node.slice(4)), taken)
    for (const node of nodes) portNet.set(node, net)
    for (const other of nets) if (other !== net) netNames.set(other, net)
    const port = bus?.bus ?? net
    ports.set(port, bus ? { name: port, bus: true } : { name: port })
  }

  // A pin already wired to the net on its side needs no second trace.
  const pairKey = (a: string, b: string) => [a, b].sort().join("|")
  const renamed = (node: string) => (node.startsWith("net:") ? `net:${netNames.get(node.slice(4)) ?? node.slice(4)}` : node)
  const pairs = (traces: readonly TraceInfo[], rename: (node: string) => string) =>
    new Set(traces.flatMap((t) => (t.from === undefined || t.to === undefined ? [] : [pairKey(rename(nodeOf(t.from)), rename(nodeOf(t.to)))])))
  const kept = pairs(model.traces.filter((t) => !touches(t)), (node) => node)
  const inSheet = pairs(moved, renamed)
  const parentTraces = new Map<string, PinToNet>()
  const sheetTraces = new Map<string, PinToNet>()
  for (const trace of crossing) {
    for (const end of endsOf(trace)) {
      const node = nodeOf(end)
      const part = partOfNode(node)
      const net = portNet.get(node)
      if (part === undefined || net === undefined) continue
      const pin = node.slice(4)
      const page = model.parts.find((p) => p.name === part)?.page
      const target = inside.has(part) ? sheetTraces : parentTraces
      if ((inside.has(part) ? inSheet : kept).has(pairKey(node, `net:${net}`))) continue
      target.set(pin, { pin, net, ...(page === undefined || inside.has(part) ? {} : { page }) })
    }
  }
  const sortedPorts = [...ports.values()].sort((a, b) => naturalCompare(a.name, b.name))
  const page = parts[0]?.page
  return {
    ...(page === undefined ? {} : { page }),
    parts,
    ports: sortedPorts,
    connections: Object.fromEntries(sortedPorts.map((port) => [port.name, port.name])),
    mapping: localDesignators(parts.map((part) => part.name), rename),
    moved,
    parentTraces: [...parentTraces.values()],
    sheetTraces: [...sheetTraces.values()],
    netNames,
  }
}
