import type { CopperLayer } from "../../core/layout-file.js"
import type { CopperPiece } from "../checks/copper-pieces.js"
import { boardEdge, keepoutHit } from "../checks/drc-copper.js"
import { shapeDistance, type Shape } from "../checks/geometry.js"
import { breaksMinimum } from "../checks/limits.js"
import { naturalCompare } from "../order.js"
import { requiredClearance } from "../rules/classes.js"
import { BOARD_EDGE, grow, type NetRule, type RouterWorld } from "./grid.js"
import { boxOf, type Obstacle } from "./obstacles.js"

/**
 * The exact check the grid stands in for, for copper the router lays off the grid (a leg from a pad centre, a copy of
 * a route into another instance): the gap to other nets' copper and pads, the hole spacing of a via, the board edge,
 * keepouts and non-plated holes (kept at the board-edge clearance). Same net copper is never in the way, but a via keeps off the net's own pads, as on the grid.
 */

/** Copper about to be laid: a track (shapes on one layer) or a via (a disc on every layer, with its hole). */
export interface Laid {
  kind: "track" | "via"
  layers: readonly CopperLayer[]
  shapes: Shape[]
  hole?: Shape
}

const shareLayer = (a: readonly CopperLayer[], b: readonly CopperLayer[]) => a.some((layer) => b.includes(layer))
const nearer = (a: readonly Shape[], b: readonly Shape[], minimum: number) => a.some((sa) => b.some((sb) => breaksMinimum(shapeDistance(sa, sb), minimum)))

/** What the piece would come too near to, by name, in natural order; empty when it is clear. */
export function offenders(world: RouterWorld, rule: NetRule, laid: Laid, extra: readonly Obstacle[] = []): string[] {
  const box = boxOf(laid.shapes)
  const reach = grow(box, world.widestGap + world.rules.fabrication.minHoleToHole + rule.via.diameter)
  const overlaps = (other: Obstacle) => other.box.minX <= reach.maxX && other.box.maxX >= reach.minX && other.box.minY <= reach.maxY && other.box.maxY >= reach.minY
  const near = [...world.index.query(reach), ...extra.filter(overlaps)]
  const found = new Set<string>()
  for (const other of near) {
    if (!shareLayer(laid.layers, other.layers) && other.hole === undefined) continue
    const foreign = other.net !== rule.net
    if (foreign && shareLayer(laid.layers, other.layers) && nearer(laid.shapes, other.shapes, requiredClearance(world.rules, rule.className, other.className))) found.add(other.id)
    if (!foreign && laid.kind === "via" && other.kind === "pad" && nearer(laid.shapes, other.shapes, 0)) found.add(other.id)
    if (laid.hole !== undefined && other.hole !== undefined && nearer([laid.hole], [other.hole], world.rules.fabrication.minHoleToHole)) found.add(other.id)
  }
  const piece: CopperPiece = { id: "laid", kind: laid.kind, className: rule.className, layers: laid.layers, shapes: laid.shapes, at: laid.shapes[0]?.core[0] ?? { x: 0, y: 0 } }
  for (const keepout of world.keepouts) if (keepoutHit(piece, keepout) !== undefined) found.add(keepout.id)
  for (const hole of world.holes) if (nearer(laid.shapes, [{ core: [{ x: hole.x, y: hole.y }], radius: hole.diameter / 2 }], world.rules.fabrication.boardEdgeClearance)) found.add(hole.id)
  if (world.board !== undefined && boardEdge(piece, world.board.outline, world.rules) !== undefined) found.add(BOARD_EDGE)
  return [...found].sort(naturalCompare)
}
