// How a schematic drawing looks: its line width on the sheet, its dashes, its colour and its fill. The drawing, the
// hover and the hit test share these, so what is drawn is what is picked. Pure: plain TypeScript with .js imports.
import type { LineStyle, SchematicDrawing } from "../../../src/engine/model.js"
import { sheetPalette } from "./schematic-theme.js"

/** A wire's width on the sheet, in sheet units (schematic-draw.ts draws wires with it). */
export const WIRE_WIDTH = 0.02
/** A bus is drawn three times as wide as a wire, in the wire's colour. */
export const BUS_WIDTH = 3 * WIRE_WIDTH
/** Text smaller than this on screen, in CSS pixels, is not written, and so cannot be picked either. */
export const MIN_TEXT_PX = 3
/** A filled rectangle or circle is washed with its colour at this alpha, as two hex digits (0.2 × 255 = 51). */
export const FILL_ALPHA_HEX = "33"

/** The line width a drawing gives itself, in sheet units: its strokeWidth, a bus's fixed width, none for a text. */
export function strokeWidthOf(drawing: SchematicDrawing): number {
  if (drawing.kind === "bus") return BUS_WIDTH
  return drawing.kind === "text" ? 0 : drawing.strokeWidth
}

/** The width a line is drawn with: its own, but never under one device pixel (`devicePx`, in sheet units). */
export const drawnWidth = (width: number, devicePx: number): number => Math.max(width, devicePx)

/** The dashes of a line style, scaled to the drawn width: long dashes for dashed, round dots for dotted (with round caps). */
export function dashOf(style: LineStyle, width: number): number[] {
  if (style === "dashed") return [4 * width, 3 * width]
  return style === "dotted" ? [0, 2 * width] : []
}

/** The line style a drawing is drawn with; a bus and a text are solid. */
export function lineStyleOf(drawing: SchematicDrawing): LineStyle {
  return drawing.kind === "bus" || drawing.kind === "text" ? "solid" : drawing.lineStyle
}

/** The drawing's own colour: the one its file gives, else the theme's (the bus colour for a bus). */
export function colorOf(drawing: SchematicDrawing): string {
  if (drawing.kind === "bus") return sheetPalette().bus
  return drawing.color ?? sheetPalette().drawing
}

/** Whether the drawing is a filled rectangle or circle. */
export const isFilled = (drawing: SchematicDrawing): boolean => (drawing.kind === "rect" || drawing.kind === "circle") && drawing.filled

/** The wash a filled shape gets: its colour at 20% alpha. */
export const fillOf = (color: string): string => `${color}${FILL_ALPHA_HEX}`
