import { padShape } from "../checks/geometry.js"
import type { Point } from "../model.js"
import type { WorldPad } from "../pcb.js"
import { shapeOutline } from "./shapes.js"

/** A thermal relief round a pad: the gap cut out of the fill, and four spokes across it. */
export interface Relief {
  /** The pad grown by the gap: the fill keeps out of it, but for the spokes. */
  cut: Point[]
  /** Four rectangles from the pad's centre along its own axes (0°, 90°, 180°, 270°), each `width` wide. */
  spokes: Point[][]
  /** For each spoke, the middle of the part past the gap: the spoke joins the fill only when the fill holds this point. */
  tips: Point[]
}

const DEG = Math.PI / 180
/** The four directions in the pad's own frame. */
const DIRECTIONS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
]

/**
 * The relief for a pad: `gap` between the pad and the fill, and four spokes `width` wide that run from the pad's
 * centre across the gap and `width` further, into the fill, so they join it. Undefined for a pad shape it cannot draw.
 */
export function thermalRelief(pad: WorldPad, gap: number, width: number): Relief | undefined {
  const shape = padShape(pad)
  if (shape === undefined) return undefined
  const [cos, sin] = [Math.cos(pad.rotation * DEG), Math.sin(pad.rotation * DEG)]
  const world = (p: Point): Point => ({ x: pad.x + p.x * cos - p.y * sin, y: pad.y + p.x * sin + p.y * cos })
  const halfHeight = (pad.shape === "circle" ? pad.width : pad.height) / 2
  const side = width / 2
  const edge = (d: Point) => (d.x !== 0 ? pad.width / 2 : halfHeight) + gap
  const tips = DIRECTIONS.map((d) => world({ x: d.x * (edge(d) + width / 2), y: d.y * (edge(d) + width / 2) }))
  const spokes = DIRECTIONS.map((d) => {
    const reach = edge(d) + width
    const across = { x: -d.y * side, y: d.x * side }
    const tip = { x: d.x * reach, y: d.y * reach }
    return [
      { x: -across.x, y: -across.y },
      { x: tip.x - across.x, y: tip.y - across.y },
      { x: tip.x + across.x, y: tip.y + across.y },
      { x: across.x, y: across.y },
    ].map(world)
  })
  return { cut: shapeOutline(shape, gap), spokes, tips }
}
