// The one place a board text (`<silkscreentext>`) becomes silkscreen strokes, in board mm: the Gerber legend files
// (layers.ts), and through them the board pictures, the 3D texture, the GLB and the HTML page, and the Studio's PCB
// view all draw these same strokes. The lettering is the designators' (stroke-font.ts). Pure.
import type { Point, SilkText } from "../model.js"
import { SILK_WIDTH } from "./designator-places.js"
import { textStrokes } from "./stroke-font.js"

/** A text's line width as a share of its height: tall text gets a bolder line, never thinner than SILK_WIDTH. */
const LINE_SHARE = 0.1

/** The silkscreen line width a text of this height is drawn with, in mm. */
export const silkTextLineWidth = (height: number): number => Math.max(SILK_WIDTH, height * LINE_SHARE)

/**
 * The text's strokes on the board: its words centred on (x, y), `height` tall, turned `rotation` degrees
 * counter-clockwise; on the bottom side mirrored left to right after the turn, as a part on the bottom is, so it reads
 * the right way round (and turned the same way) when the board is turned over.
 */
export function silkTextStrokes(text: Pick<SilkText, "text" | "x" | "y" | "layer" | "height" | "rotation">): Point[][] {
  const radians = (text.rotation * Math.PI) / 180
  const [cos, sin] = [Math.cos(radians), Math.sin(radians)]
  const side = text.layer === "bottom" ? -1 : 1
  return textStrokes(text.text, { x: 0, y: 0 }, text.height).map((line) =>
    line.map((p) => ({ x: text.x + side * (p.x * cos - p.y * sin), y: text.y + p.x * sin + p.y * cos })),
  )
}

/** Every point of a text's ink outline lies within this box: its strokes grown by half the line width. */
export function silkTextBox(text: Pick<SilkText, "text" | "x" | "y" | "layer" | "height" | "rotation">): { minX: number; minY: number; maxX: number; maxY: number } {
  const points = silkTextStrokes(text).flat()
  const half = silkTextLineWidth(text.height) / 2
  if (points.length === 0) return { minX: text.x, minY: text.y, maxX: text.x, maxY: text.y }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs) - half, minY: Math.min(...ys) - half, maxX: Math.max(...xs) + half, maxY: Math.max(...ys) + half }
}
