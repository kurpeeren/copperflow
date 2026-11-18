// Reading a drawing (SVG or DXF) into plain shapes, for a logo or a mark placed on a board.
import { GraphicError, type GraphicKind, type GraphicShapes } from "./shapes.js"
import { readSvgGraphic, type SvgReadOptions } from "./svg.js"
import { readDxfGraphic } from "./dxf.js"

export type { GraphicKind, GraphicShapes } from "./shapes.js"
export { svgHasPhysicalSize, type SvgReadOptions } from "./svg.js"
export { ALL_LIGHT_NOTE } from "./paint-order.js"
export { CURVE_TOLERANCE_MM, MAX_TOTAL_POINTS, signedArea } from "./shapes.js"

/** Reads a drawing's text; an error says in plain words what is wrong with the file. */
export function parseGraphic(text: string, kind: GraphicKind, options: SvgReadOptions = {}): GraphicShapes | { error: string } {
  try {
    if (typeof text !== "string") return { error: "The drawing is not text" }
    return kind === "svg" ? readSvgGraphic(text, options) : readDxfGraphic(text)
  } catch (error) {
    if (error instanceof GraphicError) return { error: error.message }
    if (error instanceof RangeError) return { error: "The drawing is too deeply nested or too large to read" }
    return { error: `The drawing could not be read: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** The kind by the file's name (".svg", ".dxf"), or undefined. */
export function graphicKind(name: string): GraphicKind | undefined {
  const lower = name.toLowerCase()
  if (lower.endsWith(".svg")) return "svg"
  if (lower.endsWith(".dxf")) return "dxf"
  return undefined
}
