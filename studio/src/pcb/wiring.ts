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
  /** The schematic_port it is, when it is a pin rather than a point on a wire or label. */
  pinId?: string
}

// A net label is a small tag; pointing anywhere on it counts.
const LABEL_REACH = 0.2

/**
 * The pin, net label or wire nearest to `p` within `maxDistance`, in that order of preference.
 * Traces and labels in `skip` are not drawn (hand-drawn wires replace them), so they cannot be hit.
 */
export function wireEndAt(elements: readonly unknown[], p: Point, maxDistance: number, skip?: ReadonlySet<string>): WireEnd | undefined {
  const all = wellFormed(elements)
  const port = nearest(byType(all, "schematic_port"), (e) => distance(point(e.center), p), maxDistance)
  if (port) return portEnd(all, String(port.schematic_port_id))
  const label = nearest(
    byType(all, "schematic_net_label").filter((l) => !skip?.has(String(l.schematic_net_label_id))),
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
    if (skip?.has(String(trace.schematic_trace_id))) continue
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
  const end = source && at ? sourcePortEnd(all, source, at) : undefined
  return end && { ...end, pinId: schematicPortId }
}

/** Whether a wire between the two ends would add nothing. */
export function alreadyConnected(a: WireEnd, b: WireEnd): boolean {
  return a.selector === b.selector || (a.key !== undefined && a.key === b.key)
}

/** The two named nets a wire between `a` and `b` would join into one, e.g. GND and VCC. */
export function joinsNets(a: WireEnd, b: WireEnd): [string, string] | undefined {
  return a.net !== undefined && b.net !== undefined && a.net !== b.net ? [a.net, b.net] : undefined
}

/** A trace as the source declares it; `schematicRouteHints` are its hand-drawn corners. */
export interface DeclaredTrace {
  from?: string | undefined
  to?: string | undefined
  schematicRouteHints?: Point[] | undefined
}

export interface DrawnWires {
  /** Paths of hand-drawn wires, pin to pin through their corners, with right-angle bends. */
  wires: Point[][]
  /** For each wire, what clicking on it connects to: its net, or its first pin. */
  ends: WireEnd[]
  /** Where a hand-drawn wire ends on another wire of its net. */
  junctions: Point[]
  /**
   * schematic_trace and schematic_net_label ids the hand-drawn wires replace: tscircuit's path
   * between the same two pins, or its label stub on a pin wired by hand to a net.
   */
  hidden: Set<string>
}

/**
 * Hand-drawn wires: tscircuit lays out its own schematic paths and ignores schematicRouteHints,
 * so copperflow draws traces that have them. An end on a net stops at the corner next to it,
 * the point that was clicked on that net's wire or label. An end whose selector names a pin
 * but that stopped on a wire of an unnamed net has that point written twice (see
 * `wireHints`), so it is not stretched on to the pin.
 */
export function drawnWires(elements: readonly unknown[], traces: readonly DeclaredTrace[]): DrawnWires {
  const all = wellFormed(elements)
  const drawn: DrawnWires = { wires: [], ends: [], junctions: [], hidden: new Set() }
  for (const trace of traces) {
    const hints = trace.schematicRouteHints ?? []
    if (hints.length === 0 || !trace.from || !trace.to) continue
    const startsOnWire = isNet(trace.from) || samePoint(hints[0], hints[1])
    const endsOnWire = isNet(trace.to) || samePoint(hints[hints.length - 1], hints[hints.length - 2])
    const from = startsOnWire ? undefined : pinCenter(all, trace.from)
    const to = endsOnWire ? undefined : pinCenter(all, trace.to)
    // A selector that names a pin but finds none (a part that is not built yet) is not drawn.
    if ((!from && !startsOnWire) || (!to && !endsOnWire)) continue
    const corners = hints.filter((p, i) => !samePoint(p, hints[i - 1]))
    const vertices = [...(from ? [from] : []), ...corners, ...(to ? [to] : [])]
    const end = endOf(all, trace.from, vertices[0])
    if (vertices.length < 2 || !end) continue
    drawn.wires.push(route(vertices))
    drawn.ends.push(end)
    const first = vertices[0]
    const last = vertices[vertices.length - 1]
    if (startsOnWire && first) drawn.junctions.push(first)
    if (endsOnWire && last) drawn.junctions.push(last)
    if (from && to) {
      const replaced = byType(all, "schematic_trace").find((t) => joins(t, from, to))
      if (typeof replaced?.schematic_trace_id === "string") drawn.hidden.add(replaced.schematic_trace_id)
    }
    for (const [pin, selector] of [
      [from, trace.to],
      [to, trace.from],
    ] as const) {
      if (pin && isNet(selector)) hideLabelStub(all, pin, selector.trim().slice("net.".length), drawn.hidden)
    }
  }
  return drawn
}

/**
 * The schematicRouteHints for a wire drawn from `from` through `corners` to `to`. Pin ends are
 * left out, so they follow their pins when parts move; a point on a net's wire or label is kept,
 * and written twice when the selector names a pin of an unnamed net (see drawnWires).
 */
export function wireHints(from: WireEnd, corners: readonly Point[], to: WireEnd): Point[] {
  if (corners.length === 0) return []
  const endHints = (end: WireEnd) => (end.pinId ? [] : end.selector.startsWith("net.") ? [end.at] : [end.at, end.at])
  return [...endHints(from), ...corners, ...endHints(to)]
}

/** Hides tscircuit's label for `net` on `pin`, and the short trace leading to it, if any. */
function hideLabelStub(all: Element[], pin: Point, net: string, hidden: Set<string>): void {
  const netIds = new Set(byType(all, "source_net").filter((n) => n.name === net).map((n) => n.source_net_id))
  for (const label of byType(all, "schematic_net_label")) {
    const anchor = point(label.anchor_position)
    if (!anchor || !netIds.has(label.source_net_id) || typeof label.schematic_net_label_id !== "string") continue
    const stub = samePoint(anchor, pin) ? undefined : byType(all, "schematic_trace").find((t) => joins(t, pin, anchor))
    if (!samePoint(anchor, pin) && !stub) continue
    hidden.add(label.schematic_net_label_id)
    if (typeof stub?.schematic_trace_id === "string") hidden.add(stub.schematic_trace_id)
  }
}

function samePoint(a: Point | undefined, b: Point | undefined): boolean {
  return a !== undefined && b !== undefined && Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
}

/** The corner a schematic wire takes from `from` to `to`: across first, then up or down. */
export function elbow(from: Point, to: Point): Point[] {
  return [from, { x: to.x, y: from.y }, to]
}

/** The end a hand-drawn wire offers at `p`, the nearest point on it within `maxDistance`. */
export function drawnWireAt(drawn: DrawnWires, p: Point, maxDistance: number): WireEnd | undefined {
  let best: { end: WireEnd; distance: number } | undefined
  drawn.wires.forEach((wire, index) => {
    const end = drawn.ends[index]
    for (let i = 1; end && i < wire.length; i++) {
      const a = wire[i - 1]
      const b = wire[i]
      if (!a || !b) continue
      const at = closestOnSegment(p, a, b)
      const d = distance(at, p)
      if (d <= maxDistance && (!best || d < best.distance)) best = { end: { ...end, at }, distance: d }
    }
  })
  return best?.end
}

/** A path through `points` that bends only at right angles, across first at each bend. */
export function route(points: readonly Point[]): Point[] {
  const path: Point[] = []
  for (const p of points) {
    const last = path[path.length - 1]
    if (last && last.x !== p.x && last.y !== p.y) path.push({ x: p.x, y: last.y })
    if (!last || last.x !== p.x || last.y !== p.y) path.push(p)
  }
  return path
}

/** What a wire starting at `selector` stands for: its named net, or the pin. */
function endOf(all: Element[], selector: string, at: Point | undefined): WireEnd | undefined {
  if (!at) return undefined
  if (isNet(selector)) {
    const name = selector.trim().slice("net.".length)
    const net = byType(all, "source_net").find((n) => n.name === name)
    return net ? netEnd(net, at) : { selector: selector.trim(), at, key: undefined, label: name, net: name }
  }
  const port = sourcePortOf(all, selector)
  return port ? sourcePortEnd(all, port, at) : undefined
}

function isNet(selector: string): boolean {
  return selector.trim().startsWith("net.")
}

/** The schematic pin a `.R1 > .pin1` or `R1.pin1` selector names; aliases such as `anode` count. */
function pinCenter(all: Element[], selector: string): Point | undefined {
  const port = sourcePortOf(all, selector)
  const schematic = port && all.find((e) => e.type === "schematic_port" && e.source_port_id === port.source_port_id)
  return point(schematic?.center)
}

function sourcePortOf(all: Element[], selector: string): Element | undefined {
  const match = /^\.([\w-]+)\s*>\s*\.([\w-]+)$/.exec(selector.trim()) ?? /^([\w-]+)\.([\w-]+)$/.exec(selector.trim())
  if (!match || match[1] === "net") return undefined
  const [, part, pin] = match
  const component = all.find((e) => e.type === "source_component" && e.name === part)
  if (!component) return undefined
  return byType(all, "source_port").find(
    (p) => p.source_component_id === component.source_component_id && (p.name === pin || (Array.isArray(p.port_hints) && p.port_hints.includes(pin))),
  )
}

/** Whether a drawn schematic trace runs between exactly these two pins. */
function joins(trace: Element, a: Point, b: Point): boolean {
  const seen = new Map<string, { point: Point; count: number }>()
  for (const edge of Array.isArray(trace.edges) ? trace.edges : []) {
    for (const end of [(edge as { from?: unknown } | null)?.from, (edge as { to?: unknown } | null)?.to]) {
      const p = point(end)
      if (!p) continue
      const key = `${p.x.toFixed(3)},${p.y.toFixed(3)}`
      seen.set(key, { point: p, count: (seen.get(key)?.count ?? 0) + 1 })
    }
  }
  const terminals = [...seen.values()].filter((v) => v.count === 1).map((v) => v.point)
  const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-3
  return terminals.length === 2 && terminals.some((t) => near(t, a)) && terminals.some((t) => near(t, b))
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
