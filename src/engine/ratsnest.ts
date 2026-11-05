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

function padsByNet(parts: readonly PlacedFootprint[]): Map<string, WorldPad[]> {
  const nets = new Map<string, WorldPad[]>()
  for (const pad of parts.flatMap((part) => part.pads)) {
    if (pad.net !== undefined) nets.set(pad.net, [...(nets.get(pad.net) ?? []), pad])
  }
  return nets
}

/** Prim's tree over the pads of one net: the shortest edge from the tree to a pad outside it, ties by pad id. */
function spanningTree(net: string, pads: readonly WorldPad[]): RatsnestLine[] {
  const [first, ...rest] = [...pads].sort((a, b) => naturalCompare(a.id, b.id))
  if (!first) return []
  const inTree = [first]
  let outside = rest
  const lines: RatsnestLine[] = []
  while (outside.length > 0) {
    const edges = inTree.flatMap((from) => outside.map((to) => ({ d: distance(from, to), from, to })))
    const best = edges.reduce((a, b) => (compareEdge(b, a) < 0 ? b : a))
    lines.push({ net, from: best.from.id, to: best.to.id, a: { x: best.from.x, y: best.from.y }, b: { x: best.to.x, y: best.to.y } })
    inTree.push(best.to)
    outside = outside.filter((pad) => pad !== best.to)
  }
  return lines
}

/** The airwires: for each net, a minimum spanning tree over its pads by centre distance. */
export function ratsnest(parts: PlacedFootprint[]): RatsnestLine[] {
  const nets = padsByNet(parts)
  return [...nets.keys()].sort(naturalCompare).flatMap((net) => spanningTree(net, nets.get(net) ?? []))
}
