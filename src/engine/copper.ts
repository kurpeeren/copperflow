import { missingLayer, missingLayerMessage, type CopperLayer, type LayoutMaker, type LayoutRecord, type TrackRecord, type ViaRecord } from "../core/layout-file.js"
import { bounds, padShape, shapeDistance, type Shape } from "./checks/geometry.js"
import { GridIndex, type Box } from "./checks/grid-index.js"
import { diagnostic } from "./diagnostics.js"
import type { Diagnostic, Net, Point } from "./model.js"
import { naturalCompare } from "./order.js"
import type { PlacedFootprint, WorldPad } from "./pcb.js"

/**
 * A track on the board. `net` is the net id it carries: the one its pads give, else the one it (or its island) names
 * when the circuit has that net; none on a short.
 */
export interface PcbTrack {
  id: string
  /** The net id the copper carries, from the pads it joins or the net its record names. */
  net?: string
  /** The net as the record names it, kept as written (a name or a net id). */
  named?: string
  layer: CopperLayer
  width: number
  points: Point[]
  locked: boolean
  by: LayoutMaker
  /** The ids of the pads it touches directly, in pad order. */
  pads: string[]
  /** A layer it is on (or a via lists) that the board does not have: such copper joins nothing and is an error. */
  missingLayer?: CopperLayer
}

export interface PcbVia {
  id: string
  /** The net id the copper carries, from the pads it joins or the net its record names. */
  net?: string
  /** The net as the record names it, kept as written (a name or a net id). */
  named?: string
  at: Point
  drill: number
  diameter: number
  layers: CopperLayer[]
  locked: boolean
  by: LayoutMaker
  /** A layer it is on (or a via lists) that the board does not have: such copper joins nothing and is an error. */
  missingLayer?: CopperLayer
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
/** Side of a cell in the grids that find pads and copper near each other, in mm. */
const NEAR_CELL = 2

const padOnLayer = (pad: WorldPad, layer: CopperLayer) => pad.layers === "through" || pad.layers === layer
const pointShape = (p: Point): Shape => ({ core: [p], radius: 0 })

/** A track's length along its points, in mm: the sum of its segments. */
export function trackLength(points: readonly Point[]): number {
  return points.reduce((sum, p, i) => (i === 0 ? 0 : sum + Math.hypot(p.x - (points[i - 1]?.x ?? p.x), p.y - (points[i - 1]?.y ?? p.y))), 0)
}

/** Every layer a via joins: the stack from its first listed layer to its last. */
export function viaSpan(via: Pick<ViaRecord, "layers">): Set<CopperLayer> {
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

/** The copper of a track, one shape per segment: the centre line grown by half the width. */
function trackCopper(track: TrackRecord): Shape[] {
  const radius = track.width / 2
  if (track.points.length < 2) return track.points.map((p) => ({ core: [p], radius }))
  return track.points.slice(1).map((p, i) => ({ core: [track.points[i] as Point, p], radius }))
}

/** Copper that overlaps or touches, anywhere: the check that joins copper and the clearance check's "joined" agree on it. */
export function copperTouches(a: Shape, b: Shape): boolean {
  return shapeDistance(a, b) <= TOUCH_TOLERANCE
}

/** Two tracks on one layer whose copper meets, at an end or mid-segment. */
function tracksTouch(a: TrackRecord, b: TrackRecord): boolean {
  if (a.layer !== b.layer) return false
  const other = trackCopper(b)
  return trackCopper(a).some((sa) => other.some((sb) => copperTouches(sa, sb)))
}

/** A track whose copper meets the via's ring, on a layer the via spans. */
function trackTouchesVia(track: TrackRecord, via: ViaRecord, span: ReadonlySet<CopperLayer>): boolean {
  if (!span.has(track.layer)) return false
  const ring: Shape = { core: [via.at], radius: via.diameter / 2 }
  return trackCopper(track).some((segment) => copperTouches(segment, ring))
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

/** The box around a record's copper, a hair wider so touching copper is always found. */
function recordBox(record: LayoutRecord): Box {
  const points = record.t === "via" ? [record.at] : record.points
  const reach = (record.t === "via" ? record.diameter : record.width) / 2 + TOUCH_TOLERANCE
  return bounds({ core: points.length > 0 ? points : [{ x: 0, y: 0 }], radius: reach })
}

const finiteBox = (box: Box | undefined): box is Box => box !== undefined && [box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)

/** The indices of the items near each box, ascending; only these can touch. Items without a finite box (a part with no position) touch nothing. */
function nearIndex<T>(items: readonly T[], boxOf: (item: T) => Box | undefined): (box: Box) => number[] {
  const index = new GridIndex<number>(NEAR_CELL)
  items.forEach((item, i) => {
    const box = boxOf(item)
    if (finiteBox(box)) index.insert(i, box)
  })
  return (box) => index.query(box).sort((a, b) => a - b)
}

/** Nodes are the pads, then the records in file order: record i is node pads.length + i. */
function joinPads(graph: Graph): void {
  const shapes = graph.pads.map((pad) => padShape(pad))
  const near = nearIndex(shapes, (shape) => (shape === undefined ? undefined : bounds(shape)))
  graph.records.forEach((record, r) => {
    const node = graph.pads.length + r
    const span = record.t === "via" ? [...viaSpan(record)] : [record.layer]
    const points = record.t === "via" ? [record.at] : record.points
    const hits = near(recordBox(record)).filter((p) => {
      const pad = graph.pads[p] as WorldPad
      return span.some((layer) => padOnLayer(pad, layer)) && points.some((q) => inPad(pad, shapes[p], q))
    })
    if (record.t === "track") graph.touched.set(r, hits)
    for (const p of hits) graph.groups.join(node, p)
  })
}

/** Vias whose rings overlap on a layer they share. */
function viasTouch(a: ViaRecord, b: ViaRecord): boolean {
  const spanB = viaSpan(b)
  const shared = [...viaSpan(a)].some((layer) => spanB.has(layer))
  return shared && Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) <= (a.diameter + b.diameter) / 2 + TOUCH_TOLERANCE
}

function recordsTouch(a: LayoutRecord, b: LayoutRecord): boolean {
  if (a.t === "track" && b.t === "track") return tracksTouch(a, b)
  if (a.t === "track" && b.t === "via") return trackTouchesVia(a, b, viaSpan(b))
  if (a.t === "via" && b.t === "track") return trackTouchesVia(b, a, viaSpan(a))
  return viasTouch(a as ViaRecord, b as ViaRecord)
}

function joinRecords(graph: Graph): void {
  const { records, groups } = graph
  const offset = graph.pads.length
  const near = nearIndex(records, recordBox)
  records.forEach((record, i) => {
    for (const j of near(recordBox(record))) {
      if (j > i && recordsTouch(record, records[j] as LayoutRecord)) groups.join(offset + i, offset + j)
    }
  })
}

/** Copper joined together, in the order its first record comes in the file. */
interface Island {
  root: number
  records: number[]
  /** The nets of the pads it touches, natural order, each once. */
  nets: string[]
  touchesPad: boolean
}

function padNetsByRoot(graph: Graph): Map<number, Set<string>> {
  const padNets = new Map<number, Set<string>>()
  graph.pads.forEach((pad, p) => {
    const root = graph.groups.find(p)
    const nets = padNets.get(root) ?? new Set<string>()
    if (pad.net !== undefined) nets.add(pad.net)
    padNets.set(root, nets)
  })
  return padNets
}

function islandsOf(graph: Graph): Island[] {
  const padNets = padNetsByRoot(graph)
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
    const island: Island = { root, records: [r], nets: [...(nets ?? [])].sort(naturalCompare), touchesPad: nets !== undefined }
    byRoot.set(root, island)
    islands.push(island)
  })
  return islands
}

type Namer = (name: string | undefined) => string | undefined

/** The id of the net a record names, by id or by name; undefined for no name or a name the circuit lacks. */
function netNamer(nets: readonly Net[]): Namer {
  const ids = new Map<string, string>()
  for (const net of nets) for (const name of net.names) if (!ids.has(name)) ids.set(name, net.id)
  for (const net of nets) ids.set(net.id, net.id)
  return (name) => (name === undefined ? undefined : ids.get(name))
}

const listed = (words: readonly string[]) => (words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`)

function islandDiagnostic(island: Island, records: readonly LayoutRecord[]): Diagnostic | undefined {
  const ids = island.records.map((r) => (records[r] as LayoutRecord).id)
  const one = ids.length === 1
  if (island.nets.length > 1) {
    return diagnostic("short", "error", `${ids.join(", ")} ${one ? "joins" : "join"} the nets ${listed(island.nets)}`, [...island.nets, ...ids])
  }
  if (!island.touchesPad) return diagnostic("floating", "warning", `${ids.join(", ")} ${one ? "touches" : "touch"} no pad`, ids)
  return undefined
}

/** A record naming a net the circuit lacks, or naming one net while its pads give another. */
function recordDiagnostic(record: LayoutRecord, island: Island, named: Namer): Diagnostic | undefined {
  if (record.net === undefined) return undefined
  const id = named(record.net)
  if (id === undefined) return diagnostic("unknown-net", "warning", `${record.id} names the net ${record.net}, which the circuit does not have`, [record.id])
  const carried = island.nets.length === 1 ? island.nets[0] : undefined
  if (carried === undefined || carried === id) return undefined
  return diagnostic("mismatch", "warning", `${record.id} names the net ${id} but touches pads of ${carried}, so it carries ${carried}`, [record.id])
}

function diagnosticsOf(islands: readonly Island[], records: readonly LayoutRecord[], named: Namer): Diagnostic[] {
  return islands.flatMap((island) => [
    ...island.records.flatMap((r) => recordDiagnostic(records[r] as LayoutRecord, island, named) ?? []),
    ...[islandDiagnostic(island, records)].filter((d): d is Diagnostic => d !== undefined),
  ])
}

/** Each record's net: its pads' net; on a short none; otherwise the one it names, else the first its island names. */
function islandNets(island: Island, records: readonly LayoutRecord[], named: Namer): [number, string | undefined][] {
  const own = (r: number) => named((records[r] as LayoutRecord).net)
  const firstNamed = island.records.map(own).find((net) => net !== undefined)
  return island.records.map((r) => [r, island.nets.length > 1 ? undefined : (island.nets[0] ?? own(r) ?? firstNamed)])
}

function copperItem(record: LayoutRecord, net: string | undefined, pads: readonly string[]): PcbTrack | PcbVia {
  const extra = { ...(net === undefined ? {} : { net }), ...(record.net === undefined ? {} : { named: record.net }) }
  const { locked, by } = record
  if (record.t === "track") return { id: record.id, ...extra, layer: record.layer, width: record.width, points: record.points, locked, by, pads: [...pads] }
  return { id: record.id, ...extra, at: record.at, drill: record.drill, diameter: record.diameter, layers: record.layers, locked, by }
}

/** Each pad's group for the ratsnest; pads joined only through a short stay apart, so their airwires remain. */
function padIslands(graph: Graph, islands: readonly Island[]): Map<string, number> {
  const shorted = new Set(islands.filter((island) => island.nets.length > 1).map((island) => island.root))
  return new Map(
    graph.pads.map((pad, p) => {
      const root = graph.groups.find(p)
      return [pad.id, shorted.has(root) ? -1 - p : root]
    }),
  )
}

/** Copper on layers the board has, resolved: items in the given order, the pads' groups, and the findings. */
function resolveKept(pads: WorldPad[], records: readonly LayoutRecord[], nets: readonly Net[]): Copper & { items: (PcbTrack | PcbVia)[] } {
  const graph: Graph = { pads, records: [...records], groups: new Groups(pads.length + records.length), touched: new Map() }
  joinPads(graph)
  joinRecords(graph)
  const named = netNamer(nets)
  const islands = islandsOf(graph)
  const netOf = new Map(islands.flatMap((island) => islandNets(island, records, named)))
  const items = records.map((record, r) => copperItem(record, netOf.get(r), (graph.touched.get(r) ?? []).map((p) => (pads[p] as WorldPad).id)))
  return { items, tracks: [], vias: [], islands: padIslands(graph, islands), diagnostics: diagnosticsOf(islands, records, named) }
}

/**
 * Resolves the layout file's copper against the placed pads: which pads and copper touch, the net each piece carries,
 * shorts (copper joining pads of two nets), floating copper (touching no pad), and records whose named net is unknown
 * or differs from their pads' net. With `boardLayers`, copper on a layer the board lacks (inner1 on a 2-layer board)
 * is a `copper-layer` error and joins nothing: it carries no net and the ratsnest keeps its lines. Records keep their
 * file order.
 */
export function resolveCopper(parts: readonly PlacedFootprint[], records: readonly LayoutRecord[], nets: readonly Net[], boardLayers?: 2 | 4): Copper {
  const missing = records.map((record) => (boardLayers === undefined ? undefined : missingLayer(record, boardLayers)))
  const kept = resolveKept(
    parts.flatMap((part) => part.pads),
    records.filter((_, i) => missing[i] === undefined),
    nets,
  )
  let next = 0
  const items = records.map((record, i) => {
    const layer = missing[i]
    return layer === undefined ? (kept.items[next++] as PcbTrack | PcbVia) : { ...copperItem(record, undefined, []), missingLayer: layer }
  })
  const layerErrors = records.flatMap((record) => {
    const message = boardLayers === undefined ? undefined : missingLayerMessage(record, boardLayers)
    return message === undefined ? [] : [diagnostic("copper-layer", "error", message, [record.id])]
  })
  return {
    tracks: items.filter((item): item is PcbTrack => "points" in item),
    vias: items.filter((item): item is PcbVia => "at" in item),
    islands: kept.islands,
    diagnostics: [...layerErrors, ...kept.diagnostics],
  }
}
