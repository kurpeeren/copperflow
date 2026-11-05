import type { Point } from "./model.js"
import { naturalCompare } from "./order.js"
import type { PlacedFootprint, RatsnestLine, WorldPad } from "./pcb.js"

interface Edge {
  d: number
  from: WorldPad
  to: WorldPad
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const compareEdge = (a: Edge, b: Edge) => a.d - b.d || naturalCompare(a.from.id, b.from.id) || naturalCompare(a.to.id, b.to.id)
const edgeBetween = (from: WorldPad, to: WorldPad): Edge => ({ d: distance(from, to), from, to })

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
function spanningTree(net: string, pads: readonly WorldPad[]): RatsnestLine[] {
  const [first, ...rest] = [...pads].sort((a, b) => naturalCompare(a.id, b.id))
  if (!first) return []
  let outside = rest.map((pad) => edgeBetween(first, pad))
  const lines: RatsnestLine[] = []
  while (outside.length > 0) {
    const best = outside.reduce((a, b) => (compareEdge(b, a) < 0 ? b : a))
    lines.push({ net, from: best.from.id, to: best.to.id, a: { x: best.from.x, y: best.from.y }, b: { x: best.to.x, y: best.to.y } })
    outside = outside
      .filter((edge) => edge.to !== best.to)
      .map((edge) => {
        const viaNew = edgeBetween(best.to, edge.to)
        return compareEdge(viaNew, edge) < 0 ? viaNew : edge
      })
  }
  return lines
}

/** The airwires: for each net, a minimum spanning tree over its pads by centre distance. */
export function ratsnest(parts: PlacedFootprint[]): RatsnestLine[] {
  const nets = padsByNet(parts)
  return [...nets.keys()].sort(naturalCompare).flatMap((net) => spanningTree(net, nets.get(net) ?? []))
}
