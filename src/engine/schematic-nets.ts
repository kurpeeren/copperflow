import type { Circuit, Net, Point, Side } from "./model.js"
import { naturalCompare } from "./order.js"
import type { NetLabel, Wire } from "./schematic.js"
import { clean } from "./symbols/types.js"

export const DEFAULT_MAX_TRACE_DISTANCE = 3

const GROUND = /^[ADPF]?GND\w*$|^VSS\w*$/i
const POWER = /^(VCC|VDD|VBUS|VIN|V\d|\+)/i
/** Slack for comparing distances that went through floating point. */
const EPSILON = 1e-9

/** Where a pin ends on the sheet and which way it faces. */
export interface PinSpot {
  end: Point
  side: Side
}

/** What hand-drawn connections already decided. */
export interface Drawn {
  /** Pairs of pins that a drawn wire joins. */
  joins: readonly (readonly [string, string])[]
  /** Pins whose hand-drawn wire already carries its own net label. */
  labeled: ReadonlySet<string>
}

export const pointKey = (p: Point): string => `${p.x},${p.y}`
export const samePoint = (a: Point, b: Point): boolean => a.x === b.x && a.y === b.y

/** Runs horizontally from `from` to the x of `to`, then vertically. No zero-length segments; none at all when the points coincide. */
export function rightAngle(from: Point, to: Point): Point[] {
  if (samePoint(from, to)) return []
  if (from.x === to.x || from.y === to.y) return [from, to]
  return [from, { x: to.x, y: from.y }, to]
}

export function labelStyle(name: string): NetLabel["style"] {
  if (GROUND.test(name)) return "ground"
  return POWER.test(name) ? "power" : "label"
}

/** The name a label shows: a ground or power name when the net has one, else the first. */
export function labelName(net: Net): string | undefined {
  return net.names.find((name) => labelStyle(name) !== "label") ?? net.names[0]
}

class Groups {
  private readonly parent = new Map<string, string>()

  find(id: string): string {
    const up = this.parent.get(id)
    if (up === undefined || up === id) return id
    const root = this.find(up)
    this.parent.set(id, root)
    return root
  }

  join(a: string, b: string): boolean {
    const [ra, rb] = [this.find(a), this.find(b)]
    if (ra === rb) return false
    this.parent.set(ra, rb)
    return true
  }
}

const manhattan = (a: Point, b: Point): number => clean(Math.abs(a.x - b.x) + Math.abs(a.y - b.y))

interface Edge {
  a: string
  b: string
  length: number
}

function candidateEdges(pins: readonly string[], spots: ReadonlyMap<string, PinSpot>): Edge[] {
  const edges: Edge[] = []
  for (const [i, a] of pins.entries()) {
    for (const b of pins.slice(i + 1)) {
      const [from, to] = [spots.get(a), spots.get(b)]
      if (from && to) edges.push({ a, b, length: manhattan(from.end, to.end) })
    }
  }
  return edges.sort((x, y) => x.length - y.length || naturalCompare(x.a, y.a) || naturalCompare(x.b, y.b))
}

/** Minimum spanning tree over the pins, growing from the groups the drawn wires already made. Edges in tree order. */
function treeEdges(pins: readonly string[], spots: ReadonlyMap<string, PinSpot>, joins: Drawn["joins"]): Edge[] {
  const tree = new Groups()
  for (const [a, b] of joins) tree.join(a, b)
  return candidateEdges(pins, spots).filter((edge) => tree.join(edge.a, edge.b))
}

const clusterLabel = (net: Net, name: string, pin: string, spot: PinSpot): NetLabel => ({
  id: `label:${net.id}:${pin}`,
  net: net.id,
  text: name,
  at: spot.end,
  side: spot.side,
  style: labelStyle(name),
})

function clustersOf(pins: readonly string[], groups: Groups): string[][] {
  const byRoot = new Map<string, string[]>()
  for (const pin of pins) byRoot.set(groups.find(pin), [...(byRoot.get(groups.find(pin)) ?? []), pin])
  return [...byRoot.values()].sort((a, b) => naturalCompare(a[0] ?? "", b[0] ?? ""))
}

function labelsFor(net: Net, name: string, clusters: readonly string[][], spots: ReadonlyMap<string, PinSpot>, drawn: Drawn): NetLabel[] {
  const wanted = labelStyle(name) !== "label" || clusters.length >= 2
  if (!wanted) return []
  return clusters.flatMap((cluster) => {
    const first = cluster[0]
    const spot = first === undefined ? undefined : spots.get(first)
    if (first === undefined || !spot || cluster.some((pin) => drawn.labeled.has(pin))) return []
    return [clusterLabel(net, name, first, spot)]
  })
}

/** Wires between near pins of each named net, and the labels and ground or power symbols of the rest. */
export function layoutNets(circuit: Circuit, spots: ReadonlyMap<string, PinSpot>, drawn: Drawn): { wires: Wire[]; labels: NetLabel[] } {
  const maxLength = circuit.board?.schMaxTraceDistance ?? DEFAULT_MAX_TRACE_DISTANCE
  const groups = new Groups()
  for (const [a, b] of drawn.joins) groups.join(a, b)
  const wires: Wire[] = []
  const labels: NetLabel[] = []
  for (const net of circuit.nets) {
    const name = labelName(net)
    if (name === undefined) continue
    const pins = net.pins.filter((pin) => spots.has(pin)).sort(naturalCompare)
    const drawnEdges = treeEdges(pins, spots, drawn.joins).filter((edge) => edge.length <= maxLength + EPSILON)
    for (const edge of drawnEdges) groups.join(edge.a, edge.b)
    drawnEdges.forEach((edge, index) => {
      const points = rightAngle(spots.get(edge.a)?.end ?? { x: 0, y: 0 }, spots.get(edge.b)?.end ?? { x: 0, y: 0 })
      if (points.length > 0) wires.push({ id: `wire:${net.id}:${index + 1}`, net: net.id, points })
    })
    labels.push(...labelsFor(net, name, clustersOf(pins, groups), spots, drawn))
  }
  return { wires, labels }
}

const between = (v: number, a: number, b: number): boolean => v >= Math.min(a, b) && v <= Math.max(a, b)

function onSegment(p: Point, a: Point, b: Point): boolean {
  if (a.x === b.x) return p.x === a.x && between(p.y, a.y, b.y)
  if (a.y === b.y) return p.y === a.y && between(p.x, a.x, b.x)
  return false
}

const isInside = (p: Point, wire: Wire): boolean => {
  const { points } = wire
  const [first, last] = [points[0], points[points.length - 1]]
  if ((first && samePoint(p, first)) || (last && samePoint(p, last))) return false
  return points.some((q, i) => i > 0 && onSegment(p, points[i - 1] ?? q, q))
}

/** Points where three or more wire or pin ends meet, or where a wire ends inside another wire. */
export function junctionsOf(wires: readonly Wire[], spots: ReadonlyMap<string, PinSpot>): Point[] {
  const counts = new Map<string, { point: Point; ends: number; wireEnds: number }>()
  const add = (point: Point, wireEnd: boolean): void => {
    const entry = counts.get(pointKey(point)) ?? { point, ends: 0, wireEnds: 0 }
    counts.set(pointKey(point), { point, ends: entry.ends + 1, wireEnds: entry.wireEnds + (wireEnd ? 1 : 0) })
  }
  for (const wire of wires) {
    const [first, last] = [wire.points[0], wire.points[wire.points.length - 1]]
    if (first) add(first, true)
    if (last) add(last, true)
  }
  for (const spot of spots.values()) add(spot.end, false)
  return [...counts.values()]
    .filter((entry) => entry.wireEnds > 0 && (entry.ends >= 3 || wires.some((wire) => isInside(entry.point, wire))))
    .map((entry) => entry.point)
    .sort((a, b) => a.x - b.x || a.y - b.y)
}
