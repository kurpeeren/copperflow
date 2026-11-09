// What placement decides from the netlist alone: which nets are ground or power, the order the chips
// stand in by signal flow, and which chip pin each two-pin passive hangs from.
import type { Circuit, Component, Pin, PinType } from "./model.js"
import { naturalCompare } from "./order.js"
import { labelStyle } from "./schematic-nets.js"

export type NetKind = "ground" | "power" | "signal"

export interface Netlist {
  /** Pin id to net id. */
  netOf: ReadonlyMap<string, string>
  /** Net id to its kind. */
  kindOf: ReadonlyMap<string, NetKind>
}

/** A chip pin a passive can hang from; `index` is the chip's place in the row. */
export interface AnchorPin {
  anchor: string
  index: number
  pin: Pin
}

/** One end of a passive and the chip pin it meets. */
export interface Hook {
  own: Pin
  at: AnchorPin
}

/** A shunt to ground hangs below the chip, a shunt to power stands above it, a series part sits in line with the pin. */
export type Attachment =
  | { kind: "ground" | "power" | "series"; part: string; hook: Hook }
  | { kind: "between"; part: string; left: Hook; right: Hook }

const DRIVES: ReadonlySet<PinType> = new Set(["output", "power_out"])
const TAKES: ReadonlySet<PinType> = new Set(["input", "power_in"])
/** Which chip pin a passive prefers: the one it serves (an input) first, then a source, then the rest. */
const PREFERENCE: Readonly<Record<PinType, number>> = {
  power_in: 0,
  input: 0,
  power_out: 1,
  output: 1,
  bidirectional: 2,
  passive: 2,
  ground: 3,
  no_connect: 3,
}

function pushTo<T>(lists: Map<string, T[]>, key: string, value: T): void {
  const list = lists.get(key)
  if (list) list.push(value)
  else lists.set(key, [value])
}

function netKind(names: readonly string[], types: readonly (PinType | undefined)[]): NetKind {
  if (names.some((name) => labelStyle(name) === "ground") || types.includes("ground")) return "ground"
  if (names.some((name) => labelStyle(name) === "power")) return "power"
  return types.includes("power_in") || types.includes("power_out") ? "power" : "signal"
}

/** A net is ground when a name or a pin says so, power when a name or a power pin says so, else signal. */
export function netlistOf(circuit: Circuit): Netlist {
  const typeOf = new Map(circuit.components.flatMap((component) => component.pins.map((pin) => [pin.id, pin.type] as const)))
  const netOf = new Map<string, string>()
  const kindOf = new Map<string, NetKind>()
  for (const net of circuit.nets) {
    for (const pin of net.pins) netOf.set(pin, net.id)
    kindOf.set(net.id, netKind(net.names, net.pins.map((pin) => typeOf.get(pin))))
  }
  return { netOf, kindOf }
}

/** Edges from each chip that drives a net to each chip that takes it, ground nets left out. */
function flowEdges(anchors: readonly Component[], netlist: Netlist): Map<string, Set<string>> {
  const drivers = new Map<string, string[]>()
  const takers = new Map<string, string[]>()
  for (const anchor of anchors) {
    for (const pin of anchor.pins) {
      const net = netlist.netOf.get(pin.id)
      if (net === undefined || netlist.kindOf.get(net) === "ground") continue
      const into = DRIVES.has(pin.type) ? drivers : TAKES.has(pin.type) ? takers : undefined
      if (into) pushTo(into, net, anchor.id)
    }
  }
  const edges = new Map<string, Set<string>>()
  for (const [net, from] of drivers) {
    for (const a of from) {
      for (const b of takers.get(net) ?? []) if (a !== b) edges.set(a, (edges.get(a) ?? new Set()).add(b))
    }
  }
  return edges
}

/** Longest-path layers; a cycle is broken at its first name in natural order. */
function layersOf(names: readonly string[], edges: ReadonlyMap<string, ReadonlySet<string>>): Map<string, number> {
  const indegree = new Map(names.map((name) => [name, 0]))
  for (const targets of edges.values()) for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1)
  const layer = new Map(names.map((name) => [name, 0]))
  const left = [...names]
  while (left.length > 0) {
    const ready = left.findIndex((name) => indegree.get(name) === 0)
    const [name] = left.splice(Math.max(0, ready), 1)
    if (name === undefined) break
    for (const target of edges.get(name) ?? []) {
      if (!left.includes(target)) continue
      layer.set(target, Math.max(layer.get(target) ?? 0, (layer.get(name) ?? 0) + 1))
      indegree.set(target, (indegree.get(target) ?? 0) - 1)
    }
  }
  return layer
}

/** The chips left to right: sources of signal and power first, the chips they feed after them, ties by name. */
export function flowOrder(anchors: readonly Component[], netlist: Netlist): string[] {
  const names = anchors.map((anchor) => anchor.id).sort(naturalCompare)
  const layer = layersOf(names, flowEdges(anchors, netlist))
  return [...names].sort((a, b) => (layer.get(a) ?? 0) - (layer.get(b) ?? 0))
}

/** The chip pins on each net, best first: by preference, then the chip's place in the row, then pin number. */
export function anchorPinsByNet(anchors: readonly Component[], netlist: Netlist): Map<string, AnchorPin[]> {
  const byNet = new Map<string, AnchorPin[]>()
  for (const [index, anchor] of anchors.entries()) {
    for (const pin of anchor.pins) {
      const net = netlist.netOf.get(pin.id)
      if (net !== undefined) pushTo(byNet, net, { anchor: anchor.id, index, pin })
    }
  }
  const better = (a: AnchorPin, b: AnchorPin): number =>
    PREFERENCE[a.pin.type] - PREFERENCE[b.pin.type] || a.index - b.index || a.pin.number - b.pin.number
  for (const pins of byNet.values()) pins.sort(better)
  return byNet
}

const kindAt = (pin: Pin, netlist: Netlist): NetKind => {
  const net = netlist.netOf.get(pin.id)
  return net === undefined ? "signal" : (netlist.kindOf.get(net) ?? "signal")
}

/** A series part with a chip on each end goes between them; with one, in line with that chip's pin. */
function seriesAttachment(part: string, pins: readonly Pin[], options: (pin: Pin) => AnchorPin[]): Attachment | undefined {
  const [a, b] = pins
  if (!a || !b) return undefined
  const first = options(a)[0]
  const second = options(b).find((option) => option.anchor !== first?.anchor)
  if (first && second) {
    const [left, right] = first.index < second.index ? [{ own: a, at: first }, { own: b, at: second }] : [{ own: b, at: second }, { own: a, at: first }]
    return { kind: "between", part, left, right }
  }
  const lone = first ? { own: a, at: first } : second ? { own: b, at: second } : undefined
  return lone ? { kind: "series", part, hook: lone } : undefined
}

/**
 * Where a two-ended part hangs: a passive, or a chain of them given by its two outer pins. To ground it hangs
 * below a chip pin on its other net, to power it stands above the chip pin on its signal net, otherwise it goes in
 * line (or between two chips). With `fallback`, a part whose own rule finds no chip pin goes in line with any
 * chip pin on one of its nets. Undefined when it hangs from nothing; `name` keys the result.
 */
export function attachmentOf(name: string, ends: readonly Pin[], netlist: Netlist, byNet: ReadonlyMap<string, AnchorPin[]>, fallback = false): Attachment | undefined {
  const options = (pin: Pin): AnchorPin[] => {
    const net = netlist.netOf.get(pin.id)
    return net === undefined ? [] : (byNet.get(net) ?? [])
  }
  const kinds = ends.map((pin) => kindAt(pin, netlist))
  const grounded = kinds.filter((kind) => kind === "ground").length
  if (ends.length !== 2 || grounded === 2) return undefined
  const shunt = grounded === 1 ? "ground" : kinds.includes("power") && kinds.includes("signal") ? "power" : undefined
  if (shunt === undefined) return seriesAttachment(name, ends, options)
  const own = ends[shunt === "ground" ? kinds.findIndex((kind) => kind !== "ground") : kinds.indexOf("signal")]
  const at = own ? options(own)[0] : undefined
  if (own && at) return { kind: shunt, part: name, hook: { own, at } }
  if (!fallback || shunt === "ground") return undefined
  const power = ends[kinds.indexOf("power")]
  const powerAt = power ? options(power)[0] : undefined
  return power && powerAt ? { kind: "series", part: name, hook: { own: power, at: powerAt } } : undefined
}
