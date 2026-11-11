import type { Point } from "../model.js"
import type { Board, Spot } from "./constructive.js"
import { GRID, snap, type Box } from "./geometry.js"
import type { Movable } from "./scope.js"

/** One side of the area: its inward direction, and how a box is put flush against it. */
interface Edge {
  normal: Point
  /** How far the target is from this edge. */
  distance: (target: Point, area: Box) => number
  /** The centre coordinate across the edge that puts a box with these local bounds flush against it. */
  flush: (box: Box, area: Box) => number
}

const EDGES: readonly Edge[] = [
  { normal: { x: 1, y: 0 }, distance: (t, a) => t.x - a.minX, flush: (b, a) => a.minX - b.minX },
  { normal: { x: -1, y: 0 }, distance: (t, a) => a.maxX - t.x, flush: (b, a) => a.maxX - b.maxX },
  { normal: { x: 0, y: 1 }, distance: (t, a) => t.y - a.minY, flush: (b, a) => a.minY - b.minY },
  { normal: { x: 0, y: -1 }, distance: (t, a) => a.maxY - t.y, flush: (b, a) => a.maxY - b.maxY },
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

/**
 * Puts a connector against the edge nearest `target` (where the parts it connects to are), its pins facing inward,
 * at the cheapest free spot along it; the next nearest edge when that one is full. Undefined when no edge has room.
 */
export function placeConnector(board: Board, i: number, target: Point): Spot | undefined {
  const m = board.problem.movables[i] as Movable
  const area = board.problem.area.box
  const edges = EDGES.map((edge, order) => ({ edge, order, distance: edge.distance(target, area) })).sort((a, b) => a.distance - b.distance || a.order - b.order)
  for (const { edge } of edges) {
    let best: { spot: Spot; cost: number; far: number } | undefined
    for (const rot of inwardRotations(m, edge.normal)) {
      for (const spot of alongEdge(board, m, edge, rot, target)) {
        const cost = board.cost(m, spot, undefined)
        const far = Math.hypot(spot.x - target.x, spot.y - target.y)
        if (!best || cost < best.cost - 1e-9 || (Math.abs(cost - best.cost) <= 1e-9 && far < best.far - 1e-9)) best = { spot, cost, far }
      }
    }
    if (best) return best.spot
  }
  return undefined
}
