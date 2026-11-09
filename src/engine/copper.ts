import type { CopperLayer, LayoutMaker, LayoutRecord, TrackRecord, ViaRecord } from "../core/layout-file.js"
import { padShape, shapeDistance, type Shape } from "./checks/geometry.js"
import { diagnostic } from "./diagnostics.js"
import type { Diagnostic, Net, Point } from "./model.js"
import { naturalCompare } from "./order.js"
import type { PlacedFootprint, WorldPad } from "./pcb.js"

/** A track on the board. `net` is the net id it carries: the one its pads give, else the one it names; none on a short. */
export interface PcbTrack {
  id: string
  net?: string
  layer: CopperLayer
  width: number
  points: Point[]
  locked: boolean
  by: LayoutMaker
  /** The ids of the pads it touches directly, in pad order. */
  pads: string[]
}

export interface PcbVia {
  id: string
  net?: string
  at: Point
  drill: number
  diameter: number
  layers: CopperLayer[]
  locked: boolean
  by: LayoutMaker
}

export interface Copper {
  tracks: PcbTrack[]
  vias: PcbVia[]
  /** For each pad that copper joins to another pad, its group's number; pads with the same number are connected. */
  islands: Map<string, number>
  diagnostics: Diagnostic[]
}

/** Stack order, top to bottom: a via joins every layer from its first listed to its last. */
const STACK: readonly CopperLayer[] = ["top", "inner1", "inner2", "bottom"]
/** How far inside copper a point must be to count as touching, against rounding. */
const TOUCH_TOLERANCE = 1e-9

const padOnLayer = (pad: WorldPad, layer: CopperLayer) => pad.layers === "through" || pad.layers === layer
const pointShape = (p: Point): Shape => ({ core: [p], radius: 0 })

function viaSpan(via: ViaRecord): Set<CopperLayer> {
  const indices = via.layers.map((layer) => STACK.indexOf(layer))
  return new Set(STACK.slice(Math.min(...indices), Math.max(...indices) + 1))
}

function inPad(pad: WorldPad, shape: Shape | undefined, p: Point): boolean {
  return shape !== undefined && shapeDistance(shape, pointShape(p)) <= TOUCH_TOLERANCE
}

/** The pads whose copper holds the point on that layer, in part and pad order. */
export function padsUnder(parts: readonly PlacedFootprint[], at: Point, layer: CopperLayer): WorldPad[] {
  return parts.flatMap((part) => part.pads.filter((pad) => padOnLayer(pad, layer) && inPad(pad, padShape(pad), at)))
}

function distanceToPolyline(p: Point, points: readonly Point[]): number {
  let best = Infinity
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point
    const b = points[i] as Point
    best = Math.min(best, shapeDistance(pointShape(p), { core: [a, b], radius: 0 }))
  }
  return best
}

/** A point of one track within half the width of the other, both ways round. */
function tracksTouch(a: TrackRecord, b: TrackRecord): boolean {
  if (a.layer !== b.layer) return false
  const reaches = (from: TrackRecord, to: TrackRecord) => from.points.some((p) => distanceToPolyline(p, to.points) <= to.width / 2 + TOUCH_TOLERANCE)
  return reaches(a, b) || reaches(b, a)
}

/** A track point within the via's ring, or the via's centre within half the track's width. */
function trackTouchesVia(track: TrackRecord, via: ViaRecord, span: ReadonlySet<CopperLayer>): boolean {
  if (!span.has(track.layer)) return false
  const near = (p: Point) => Math.hypot(p.x - via.at.x, p.y - via.at.y) <= via.diameter / 2 + TOUCH_TOLERANCE
  return track.points.some(near) || distanceToPolyline(via.at, track.points) <= track.width / 2 + TOUCH_TOLERANCE
}

class Groups {
  private readonly parent: number[]
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i)
  }
  find(i: number): number {
    let root = i
    while (this.parent[root] !== root) root = this.parent[root] as number
    while (this.parent[i] !== root) [i, this.parent[i]] = [this.parent[i] as number, root]
    return root
  }
  join(a: number, b: number): void {
    const [ra, rb] = [this.find(a), this.find(b)]
    if (ra !== rb) this.parent[Math.max(ra, rb)] = Math.min(ra, rb)
  }
}

interface Graph {
  pads: WorldPad[]
  records: LayoutRecord[]
  groups: Groups
  /** For each track, the indices of the pads it touches. */
  touched: Map<number, number[]>
}

/** Nodes are the pads, then the records in file order: record i is node pads.length + i. */
function joinPads(graph: Graph): void {
  const shapes = graph.pads.map((pad) => padShape(pad))
  graph.records.forEach((record, r) => {
    const node = graph.pads.length + r
    const span = record.t === "via" ? [...viaSpan(record)] : [record.layer]
    const points = record.t === "via" ? [record.at] : record.points
    const hits = graph.pads.flatMap((pad, p) =>
      span.some((layer) => padOnLayer(pad, layer)) && points.some((q) => inPad(pad, shapes[p], q)) ? [p] : [],
    )
    if (record.t === "track") graph.touched.set(r, hits)
    for (const p of hits) graph.groups.join(node, p)
  })
}

function recordsTouch(a: LayoutRecord, b: LayoutRecord): boolean {
  if (a.t === "track" && b.t === "track") return tracksTouch(a, b)
  if (a.t === "track" && b.t === "via") return trackTouchesVia(a, b, viaSpan(b))
  if (a.t === "via" && b.t === "track") return trackTouchesVia(b, a, viaSpan(a))
  return false
}

function joinRecords(graph: Graph): void {
  const { records, groups } = graph
  const offset = graph.pads.length
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      if (recordsTouch(records[i] as LayoutRecord, records[j] as LayoutRecord)) groups.join(offset + i, offset + j)
    }
  }
}

/** Copper joined together, in the order its first record comes in the file. */
interface Island {
  records: number[]
  /** The nets of the pads it touches, natural order, each once. */
  nets: string[]
  touchesPad: boolean
}

function islandsOf(graph: Graph): Island[] {
  const padNets = new Map<number, Set<string>>()
  graph.pads.forEach((pad, p) => {
    const root = graph.groups.find(p)
    const nets = padNets.get(root) ?? new Set<string>()
    if (pad.net !== undefined) nets.add(pad.net)
    padNets.set(root, nets)
  })
  const islands: Island[] = []
  const byRoot = new Map<number, Island>()
  graph.records.forEach((_, r) => {
    const root = graph.groups.find(graph.pads.length + r)
    const known = byRoot.get(root)
    if (known) {
      known.records.push(r)
      return
    }
    const nets = padNets.get(root)
    const island: Island = { records: [r], nets: [...(nets ?? [])].sort(naturalCompare), touchesPad: nets !== undefined }
    byRoot.set(root, island)
    islands.push(island)
  })
  return islands
}

/** A net a record names, by id or by name, as its id; a name no net has stays as written. */
function netNamer(nets: readonly Net[]): (name: string | undefined) => string | undefined {
  const ids = new Map<string, string>()
  for (const net of nets) for (const name of net.names) if (!ids.has(name)) ids.set(name, net.id)
  for (const net of nets) ids.set(net.id, net.id)
  return (name) => (name === undefined ? undefined : (ids.get(name) ?? name))
}

const listed = (words: readonly string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`)

function islandDiagnostic(island: Island, records: readonly LayoutRecord[]): Diagnostic | undefined {
  const ids = island.records.map((r) => (records[r] as LayoutRecord).id)
  const one = ids.length === 1
  if (island.nets.length > 1) {
    return diagnostic("short", "error", `${ids.join(", ")} ${one ? "joins" : "join"} the nets ${listed(island.nets)}`, island.nets)
  }
  if (!island.touchesPad) return diagnostic("floating", "warning", `${ids.join(", ")} ${one ? "touches" : "touch"} no pad`, ids)
  return undefined
}

/** Each record's net: its pads' net; on a short none; otherwise the one it names, else the first its island names. */
function islandNets(island: Island, records: readonly LayoutRecord[], named: (name: string | undefined) => string | undefined): Map<number, string | undefined> {
  const firstNamed = island.records.map((r) => named((records[r] as LayoutRecord).net)).find((net) => net !== undefined)
  return new Map(
    island.records.map((r) => {
      if (island.nets.length > 1) return [r, undefined]
      return [r, island.nets[0] ?? named((records[r] as LayoutRecord).net) ?? firstNamed]
    }),
  )
}

function copperItem(record: LayoutRecord, net: string | undefined, pads: readonly string[]): PcbTrack | PcbVia {
  const withNet = net === undefined ? {} : { net }
  const { locked, by } = record
  if (record.t === "track") return { id: record.id, ...withNet, layer: record.layer, width: record.width, points: record.points, locked, by, pads: [...pads] }
  return { id: record.id, ...withNet, at: record.at, drill: record.drill, diameter: record.diameter, layers: record.layers, locked, by }
}

/**
 * Resolves the layout file's copper against the placed pads: which pads and copper touch, the net each piece carries,
 * shorts (copper joining pads of two nets) and floating copper (touching no pad). Records keep their file order.
 */
export function resolveCopper(parts: readonly PlacedFootprint[], records: readonly LayoutRecord[], nets: readonly Net[]): Copper {
  const pads = parts.flatMap((part) => part.pads)
  const graph: Graph = { pads, records: [...records], groups: new Groups(pads.length + records.length), touched: new Map() }
  joinPads(graph)
  joinRecords(graph)
  const named = netNamer(nets)
  const islands = islandsOf(graph)
  const netOf = new Map(islands.flatMap((island) => [...islandNets(island, records, named)]))
  const items = records.map((record, r) => copperItem(record, netOf.get(r), (graph.touched.get(r) ?? []).map((p) => (pads[p] as WorldPad).id)))
  return {
    tracks: items.filter((item): item is PcbTrack => "points" in item),
    vias: items.filter((item): item is PcbVia => "at" in item),
    islands: new Map(pads.map((pad, p) => [pad.id, graph.groups.find(p)])),
    diagnostics: islands.flatMap((island) => islandDiagnostic(island, records) ?? []),
  }
}
