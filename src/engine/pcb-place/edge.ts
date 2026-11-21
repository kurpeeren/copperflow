import type { Point, Side } from "../model.js"
import type { Board, Spot } from "./constructive.js"
import { GRID, snap, type Box } from "./geometry.js"
import type { Movable, Problem } from "./scope.js"
import type { State } from "./score.js"

/**
 * One side of the area: its inward direction, and how a box is put flush against it. The sides are those of the
 * outline's bounds less the edge clearance, so on an outline that is not a rectangle a flush spot often does not fit
 * and the connector goes on the next side, or inside the board with a note.
 */
interface Edge {
  side: Side
  normal: Point
  /** How far the target is from this edge. */
  distance: (target: Point, area: Box) => number
  /** The centre coordinate across the edge that puts a box with these local bounds flush against it. */
  flush: (box: Box, area: Box) => number
}

const EDGES: readonly Edge[] = [
  { side: "left", normal: { x: 1, y: 0 }, distance: (t, a) => t.x - a.minX, flush: (b, a) => a.minX - b.minX },
  { side: "right", normal: { x: -1, y: 0 }, distance: (t, a) => a.maxX - t.x, flush: (b, a) => a.maxX - b.maxX },
  // The board is y up: the bottom edge is the least y.
  { side: "bottom", normal: { x: 0, y: 1 }, distance: (t, a) => t.y - a.minY, flush: (b, a) => a.minY - b.minY },
  { side: "top", normal: { x: 0, y: -1 }, distance: (t, a) => a.maxY - t.y, flush: (b, a) => a.maxY - b.maxY },
]

/** Spots along the edge past the first free one that are still weighed, each way. */
const EXTRA_STEPS = 8
const ROUNDING = 1000

const round = (v: number) => Math.round(v * ROUNDING) / ROUNDING

/**
 * The rotations that face the pins inward most: the pads' centre furthest from the edge relative to the courtyard's
 * centre, then the pads spread least across the edge (a pin row runs along it).
 */
function inwardRotations(m: Movable, normal: Point): number[] {
  const rank = [0, 1, 2, 3].map((rot) => {
    const pads = m.pads[rot] ?? []
    const box = m.boxes[rot] as Box
    const across = pads.map((p) => p.x * normal.x + p.y * normal.y)
    const centre = ((box.minX + box.maxX) / 2) * normal.x + ((box.minY + box.maxY) / 2) * normal.y
    const inward = across.length === 0 ? 0 : across.reduce((a, b) => a + b, 0) / across.length - centre
    const spread = across.length === 0 ? 0 : Math.max(...across) - Math.min(...across)
    return { rot, inward: round(inward), spread: round(spread) }
  })
  const best = rank.reduce((a, b) => (b.inward > a.inward || (b.inward === a.inward && b.spread < a.spread) ? b : a))
  return rank.filter((r) => r.inward === best.inward && r.spread === best.spread).map((r) => r.rot)
}

/** Free spots along one edge for one rotation: from the target's projection outward, a few past the first each way. */
function alongEdge(board: Board, m: Movable, edge: Edge, rot: number, target: Point): Spot[] {
  const area = board.problem.area.box
  const box = m.boxes[rot] as Box
  const across = edge.flush(box, area)
  const vertical = edge.normal.x !== 0
  const length = vertical ? area.maxY - area.minY : area.maxX - area.minX
  const start = snap(vertical ? target.y : target.x)
  const steps = Math.ceil(length / GRID) + 1
  const spots: Spot[] = []
  for (const direction of [1, -1]) {
    let firstFree = -1
    for (let k = direction === 1 ? 0 : 1; k <= steps; k++) {
      if (firstFree >= 0 && k > firstFree + EXTRA_STEPS) break
      const along = start + direction * k * GRID
      const spot = vertical ? { x: across, y: along, rot } : { x: along, y: across, rot }
      if (!board.fits(m, spot)) continue
      if (firstFree < 0) firstFree = k
      spots.push(spot)
    }
  }
  return spots
}

/** A spot against an edge, and which edge. */
export interface EdgeSpot {
  spot: Spot
  side: Side
}

/**
 * Puts a connector against the edge its part names (pcbEdge), else the edge nearest `target` (where the parts it
 * connects to are), its pins facing inward, at the cheapest free spot along it; the next nearest edge when that one is
 * full. Undefined when no edge has room.
 */
export function placeConnector(board: Board, i: number, target: Point): EdgeSpot | undefined {
  const m = board.problem.movables[i] as Movable
  const area = board.problem.area.box
  const chosen = m.component.pcbEdge
  const rank = (edge: Edge) => (edge.side === chosen ? 0 : 1)
  const edges = EDGES.map((edge, order) => ({ edge, order, distance: edge.distance(target, area) })).sort((a, b) => rank(a.edge) - rank(b.edge) || a.distance - b.distance || a.order - b.order)
  for (const { edge } of edges) {
    let best: { spot: Spot; cost: number; far: number } | undefined
    for (const rot of inwardRotations(m, edge.normal)) {
      for (const spot of alongEdge(board, m, edge, rot, target)) {
        const cost = board.cost(m, spot, [])
        const far = Math.hypot(spot.x - target.x, spot.y - target.y)
        if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && far < best.far - 1e-9)) best = { spot, cost, far }
      }
    }
    if (best) return { spot: best.spot, side: edge.side }
  }
  return undefined
}

/**
 * For each connector `which` takes (every one by default), where the pads it connects to are on average in `sketch`
 * (its own, other connectors' and unplaced parts' left out); a connector whose nets reach none is left out.
 */
export function connectorTargets(problem: Problem, sketch: State, unplaced: ReadonlySet<number>, which: (m: Movable) => boolean = () => true): Map<number, Point> {
  const targets = new Map<number, Point>()
  problem.movables.forEach((m, c) => {
    if (m.role !== "connector" || !which(m)) return
    const nets = new Set((m.pads[0] ?? []).map((p) => p.net).filter((n) => n >= 0))
    let [sx, sy, n] = [0, 0, 0]
    problem.movables.forEach((other, k) => {
      if (k === c || unplaced.has(k) || other.role === "connector") return
      for (const pad of other.pads[sketch.rot[k] as number] ?? []) {
        if (!nets.has(pad.net)) continue
        sx += (sketch.x[k] as number) + pad.x
        sy += (sketch.y[k] as number) + pad.y
        n++
      }
    })
    if (n > 0) targets.set(c, { x: sx / n, y: sy / n })
  })
  return targets
}
