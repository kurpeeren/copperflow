// The Import a drawing dialog's small picture: the reader's shapes (mm, y up) scaled into a box of SVG pixels (y
// down), filled areas as one path per area with its holes, lines as paths. Pure; plain TypeScript with .js imports.
import type { GraphicShapes } from "../../../src/engine/graphics/index.js"
import type { Point } from "../../../src/engine/model.js"

export interface GraphicPreview {
  /** The picture's size in pixels: the longer side is the box's. */
  width: number
  height: number
  /** One path per filled area (its outer ring and its holes), filled with the even-odd rule. */
  fills: string[]
  /** The lines, each with its width in pixels (at least a hairline). */
  strokes: { d: string; width: number }[]
}

/** Pixel coordinates are written to a hundredth. */
const DIGITS = 100
/** The thinnest line drawn, in pixels, so a line with no width of its own still shows. */
const HAIRLINE_PX = 1

const px = (value: number) => Math.round(value * DIGITS) / DIGITS

function ringPath(ring: readonly Point[], scale: number, height: number, closed: boolean): string {
  const points = ring.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x * scale)} ${px(height - p.y * scale)}`)
  return closed ? `${points.join(" ")} Z` : points.join(" ")
}

/** The shapes drawn in a box `box` pixels on its longer side, keeping the drawing's shape. */
export function graphicPreview(shapes: GraphicShapes, box: number): GraphicPreview {
  const longer = Math.max(shapes.width, shapes.height)
  const scale = longer > 0 ? box / longer : 1
  const width = px(shapes.width * scale)
  const height = px(shapes.height * scale)
  const fills = shapes.fills.map((fill) => [fill.outer, ...fill.holes].map((ring) => ringPath(ring, scale, height, true)).join(" "))
  const strokes = shapes.strokes.map((stroke) => ({ d: ringPath(stroke.points, scale, height, stroke.closed), width: Math.max(HAIRLINE_PX, px(stroke.width * scale)) }))
  return { width, height, fills, strokes }
}

const cache = new WeakMap<GraphicShapes, Map<number, GraphicPreview>>()

/** graphicPreview kept per drawing and box size, so typing in the form does not rebuild the paths. */
export function cachedPreview(shapes: GraphicShapes, box: number): GraphicPreview {
  const sizes = cache.get(shapes) ?? new Map<number, GraphicPreview>()
  cache.set(shapes, sizes)
  const made = sizes.get(box) ?? graphicPreview(shapes, box)
  sizes.set(box, made)
  return made
}
