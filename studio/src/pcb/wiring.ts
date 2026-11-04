// What a schematic wire can start or end on: a pin, a net label or an existing wire.
import type { Point } from "./geometry.js"

interface Element {
  type: string
  [key: string]: unknown
}

export interface WireEnd {
  /** The tscircuit selector a trace uses, e.g. `.R1 > .pin1` or `net.GND`. */
  selector: string
  /** Where the wire touches it. */
  at: Point
  /** tscircuit's connectivity key: ends with the same key are already on one net. */
  key: string | undefined
  /** A short name for messages, e.g. `R1.pin1` or `GND`. */
  label: string
  /** The named net it is on, if any. */
  net?: string
}

// A net label is a small tag; pointing anywhere on it counts.
const LABEL_REACH = 0.2

/** The pin, net label or wire nearest to `p` within `maxDistance`, in that order of preference. */
export function wireEndAt(elements: readonly unknown[], p: Point, maxDistance: number): WireEnd | undefined {
  const all = wellFormed(elements)
  const port = nearest(byType(all, "schematic_port"), (e) => distance(point(e.center), p), maxDistance)
  if (port) return portEnd(all, String(port.schematic_port_id))
  const label = nearest(
    byType(all, "schematic_net_label"),
    (e) => Math.min(distance(point(e.center), p), distance(point(e.anchor_position), p)) - LABEL_REACH,
    maxDistance,
  )
  if (label) {
    const net = byType(all, "source_net").find((n) => n.source_net_id === label.source_net_id)
    const at = point(label.anchor_position) ?? point(label.center)
    if (net && typeof net.name === "string" && at) return netEnd(net, at)
  }
  let best: { trace: Element; at: Point; distance: number } | undefined
  for (const trace of byType(all, "schematic_trace")) {
    for (const edge of Array.isArray(trace.edges) ? trace.edges : []) {
      const from = point((edge as { from?: unknown } | null)?.from)
      const to = point((edge as { to?: unknown } | null)?.to)
      if (!from || !to) continue
      const at = closestOnSegment(p, from, to)
      const d = distance(at, p)
      if (d <= maxDistance && (!best || d < best.distance)) best = { trace, at, distance: d }
    }
  }
  return best ? traceEnd(all, best.trace, best.at) : undefined
}

/** The wire end for a schematic pin. */
export function portEnd(elements: readonly unknown[], schematicPortId: string): WireEnd | undefined {
  const all = wellFormed(elements)
  const port = all.find((e) => e.type === "schematic_port" && e.schematic_port_id === schematicPortId)
  const at = point(port?.center)
  const source = all.find((e) => e.type === "source_port" && e.source_port_id === port?.source_port_id)
  return source && at ? sourcePortEnd(all, source, at) : undefined
}

/** Whether a wire between the two ends would add nothing. */
export function alreadyConnected(a: WireEnd, b: WireEnd): boolean {
  return a.selector === b.selector || (a.key !== undefined && a.key === b.key)
}

/** The two named nets a wire between `a` and `b` would join into one, e.g. GND and VCC. */
export function joinsNets(a: WireEnd, b: WireEnd): [string, string] | undefined {
  return a.net !== undefined && b.net !== undefined && a.net !== b.net ? [a.net, b.net] : undefined
}

/** The corner a schematic wire takes from `from` to `to`: across first, then up or down. */
export function elbow(from: Point, to: Point): Point[] {
  return [from, { x: to.x, y: from.y }, to]
}

function traceEnd(all: Element[], trace: Element, at: Point): WireEnd | undefined {
  const key = typeof trace.subcircuit_connectivity_map_key === "string" ? trace.subcircuit_connectivity_map_key : undefined
  if (key === undefined) return undefined
  const net = byType(all, "source_net").find((n) => n.subcircuit_connectivity_map_key === key && typeof n.name === "string")
  if (net) return netEnd(net, at)
  const port = byType(all, "source_port").find((s) => s.subcircuit_connectivity_map_key === key)
  return port ? sourcePortEnd(all, port, at) : undefined
}

function sourcePortEnd(all: Element[], port: Element, at: Point): WireEnd | undefined {
  const part = all.find((e) => e.type === "source_component" && e.source_component_id === port.source_component_id)?.name
  if (typeof part !== "string" || typeof port.name !== "string") return undefined
  const key = typeof port.subcircuit_connectivity_map_key === "string" ? port.subcircuit_connectivity_map_key : undefined
  const net = key === undefined ? undefined : byType(all, "source_net").find((n) => n.subcircuit_connectivity_map_key === key)?.name
  return { selector: `.${part} > .${port.name}`, at, key, label: `${part}.${port.name}`, ...(typeof net === "string" ? { net } : {}) }
}

function netEnd(net: Element, at: Point): WireEnd {
  const key = typeof net.subcircuit_connectivity_map_key === "string" ? net.subcircuit_connectivity_map_key : undefined
  return { selector: `net.${String(net.name)}`, at, key, label: String(net.name), net: String(net.name) }
}

function nearest(elements: Element[], measure: (e: Element) => number, maxDistance: number): Element | undefined {
  let best: { element: Element; distance: number } | undefined
  for (const element of elements) {
    const d = measure(element)
    if (d <= maxDistance && (!best || d < best.distance)) best = { element, distance: d }
  }
  return best?.element
}

function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

function distance(a: Point | undefined, b: Point): number {
  return a ? Math.hypot(a.x - b.x, a.y - b.y) : Number.POSITIVE_INFINITY
}

function byType(elements: Element[], type: string): Element[] {
  return elements.filter((e) => e.type === type)
}

function wellFormed(input: readonly unknown[]): Element[] {
  return input.filter((e): e is Element => typeof e === "object" && e !== null && typeof (e as Element).type === "string")
}

function point(value: unknown): Point | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const { x, y } = value as { x?: unknown; y?: unknown }
  return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined
}
