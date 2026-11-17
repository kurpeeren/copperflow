import type { Point } from "./model.js"
import { naturalCompare } from "./order.js"
import type { PcbLayout, PcbTrack } from "./pcb.js"

/**
 * The length of a net's copper between its two farthest pads, along the tracks actually joined: branches that lead
 * nowhere are not counted. Tracks are polylines, so an arc counts by the length of its points (its arc length to
 * within the points' spacing). A via counts the board's thickness.
 */
export interface NetLength {
  length: number
  /** The two pads the length runs between, in natural order. */
  from: string
  to: string
  vias: number
}

const JOIN = 1e-3

interface Graph {
  edges: Map<string, Map<string, number>>
}

function link(graph: Graph, a: string, b: string, weight: number): void {
  if (a === b) return
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    const out = graph.edges.get(x) ?? new Map<string, number>()
    out.set(y, Math.min(out.get(y) ?? Infinity, weight))
    graph.edges.set(x, out)
  }
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const vertex = (track: PcbTrack, index: number) => `${track.id}@${index}`

/** The point on segment a-b nearest p, with its distance. */
function onSegment(p: Point, a: Point, b: Point): { at: Point; d: number } {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  const at = { x: a.x + t * dx, y: a.y + t * dy }
  return { at, d: dist(p, at) }
}

/** Joins each track end to the other tracks of its layer it touches: at a vertex, or part way along a segment. */
function joinTracks(graph: Graph, tracks: readonly PcbTrack[]): void {
  for (const track of tracks) {
    const ends = [0, track.points.length - 1]
    for (const end of ends) {
      const p = track.points[end] as Point
      for (const other of tracks) {
        if (other === track || other.layer !== track.layer) continue
        const reach = Math.max(track.width, other.width) / 2 + JOIN
        other.points.forEach((q, i) => {
          if (dist(p, q) <= reach) link(graph, vertex(track, end), vertex(other, i), dist(p, q))
        })
        for (let i = 0; i + 1 < other.points.length; i += 1) {
          const hit = onSegment(p, other.points[i] as Point, other.points[i + 1] as Point)
          if (hit.d > reach) continue
          const mid = `${other.id}~${i}~${hit.at.x},${hit.at.y}`
          link(graph, mid, vertex(other, i), dist(hit.at, other.points[i] as Point))
          link(graph, mid, vertex(other, i + 1), dist(hit.at, other.points[i + 1] as Point))
          link(graph, vertex(track, end), mid, hit.d)
        }
      }
    }
  }
}

function shortest(graph: Graph, start: string): Map<string, number> {
  const done = new Map<string, number>()
  const open = new Map<string, number>([[start, 0]])
  while (open.size > 0) {
    let [best, bestCost] = ["", Infinity]
    for (const [node, cost] of open) if (cost < bestCost) [best, bestCost] = [node, cost]
    open.delete(best)
    done.set(best, bestCost)
    for (const [next, weight] of graph.edges.get(best) ?? []) {
      if (done.has(next)) continue
      const cost = bestCost + weight
      if (cost < (open.get(next) ?? Infinity)) open.set(next, cost)
    }
  }
  return done
}

/** The net's length between its two farthest joined pads; undefined when no two of its pads are joined by copper. */
export function netLength(net: string, layout: Pick<PcbLayout, "parts" | "tracks" | "vias">, boardThickness: number): NetLength | undefined {
  const tracks = layout.tracks.filter((t) => t.net === net && t.points.length >= 2)
  if (tracks.length === 0) return undefined
  const vias = layout.vias.filter((v) => v.net === net)
  const graph: Graph = { edges: new Map() }
  for (const track of tracks) {
    for (let i = 0; i + 1 < track.points.length; i += 1) link(graph, vertex(track, i), vertex(track, i + 1), dist(track.points[i] as Point, track.points[i + 1] as Point))
  }
  joinTracks(graph, tracks)
  for (const via of vias) {
    for (const layer of via.layers) {
      const node = `${via.id}:${layer}`
      if (layer !== via.layers[0]) link(graph, `${via.id}:${via.layers[0]}`, node, boardThickness)
      for (const track of tracks.filter((t) => t.layer === layer)) {
        track.points.forEach((p, i) => {
          if (dist(p, via.at) <= via.diameter / 2 + JOIN) link(graph, node, vertex(track, i), dist(p, via.at))
        })
      }
    }
  }
  const pads = layout.parts.flatMap((part) => part.pads).filter((pad) => pad.net === net)
  for (const pad of pads) {
    for (const track of tracks.filter((t) => t.pads.includes(pad.id))) {
      const nearest = track.points.reduce((best, p, i) => (dist(p, pad) < dist(track.points[best] as Point, pad) ? i : best), 0)
      link(graph, `pad:${pad.id}`, vertex(track, nearest), 0)
    }
  }
  let best: NetLength | undefined
  const ids = pads.map((pad) => pad.id).sort(naturalCompare)
  for (const [i, from] of ids.entries()) {
    const reach = shortest(graph, `pad:${from}`)
    for (const to of ids.slice(i + 1)) {
      const length = reach.get(`pad:${to}`)
      if (length !== undefined && (best === undefined || length > best.length + 1e-9)) best = { length, from, to, vias: vias.length }
    }
  }
  return best
}
