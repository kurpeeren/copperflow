import type { Point } from "./model.js"
import { naturalCompare } from "./order.js"
import type { PlacedFootprint, RatsnestLine, WorldPad } from "./pcb.js"

interface Edge {
  /** Centre distance; -1 between pads that copper already joins, so the tree takes those first and draws no line. */
  d: number
  from: WorldPad
  to: WorldPad
}

/** Which pads copper joins: pads with the same number are connected. */
export type PadIslands = ReadonlyMap<string, number>

const JOINED = -1

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const compareEdge = (a: Edge, b: Edge) => a.d - b.d || naturalCompare(a.from.id, b.from.id) || naturalCompare(a.to.id, b.to.id)
const joined = (islands: PadIslands, a: WorldPad, b: WorldPad) => {
  const island = islands.get(a.id)
  return island !== undefined && island === islands.get(b.id)
}
const edgeMaker =
  (islands: PadIslands) =>
  (from: WorldPad, to: WorldPad): Edge => ({ d: joined(islands, from, to) ? JOINED : distance(from, to), from, to })

function padsByNet(parts: readonly PlacedFootprint[]): Map<string, WorldPad[]> {
  const nets = new Map<string, WorldPad[]>()
  for (const part of parts) {
    for (const pad of part.pads) {
      if (pad.net === undefined) continue
      const pads = nets.get(pad.net)
      if (pads) pads.push(pad)
      else nets.set(pad.net, [pad])
    }
  }
  return nets
}

/**
 * Prim's tree over the pads of one net: the shortest edge from the tree to a pad outside it, ties by pad id.
 * Each pad outside keeps its best edge into the tree, so a step costs one pass over the pads left.
 */
function spanningTree(net: string, pads: readonly WorldPad[], islands: PadIslands): RatsnestLine[] {
  const edgeBetween = edgeMaker(islands)
  const [first, ...rest] = [...pads].sort((a, b) => naturalCompare(a.id, b.id))
  if (!first) return []
  let outside = rest.map((pad) => edgeBetween(first, pad))
  const lines: RatsnestLine[] = []
  while (outside.length > 0) {
    const best = outside.reduce((a, b) => (compareEdge(b, a) < 0 ? b : a))
    if (best.d !== JOINED) lines.push({ net, from: best.from.id, to: best.to.id, a: { x: best.from.x, y: best.from.y }, b: { x: best.to.x, y: best.to.y } })
    outside = outside
      .filter((edge) => edge.to !== best.to)
      .map((edge) => {
        const viaNew = edgeBetween(best.to, edge.to)
        return compareEdge(viaNew, edge) < 0 ? viaNew : edge
      })
  }
  return lines
}

/**
 * How many connections the pours make, per net (nets with none are left out, sorted by net): the airwires with only
 * the copper's islands less the airwires with the pours' joins as well, both from `ratsnest` itself.
 */
export function pourMadeConnections(parts: readonly PlacedFootprint[], bareIslands: PadIslands, islands: PadIslands): { net: string; count: number }[] {
  const perNet = new Map<string, number>()
  for (const line of ratsnest(parts, bareIslands)) perNet.set(line.net, (perNet.get(line.net) ?? 0) + 1)
  for (const line of ratsnest(parts, islands)) perNet.set(line.net, (perNet.get(line.net) ?? 0) - 1)
  return [...perNet].filter(([, count]) => count > 0).sort(([a], [b]) => naturalCompare(a, b)).map(([net, count]) => ({ net, count }))
}

/**
 * The airwires: for each net, a minimum spanning tree over its pads by centre distance, where pads that copper
 * already joins (`islands`) cost nothing and get no line, so only the connections still missing are drawn.
 */
export function ratsnest(parts: readonly PlacedFootprint[], islands: PadIslands = new Map()): RatsnestLine[] {
  const nets = padsByNet(parts)
  return [...nets.keys()].sort(naturalCompare).flatMap((net) => spanningTree(net, nets.get(net) ?? [], islands))
}
