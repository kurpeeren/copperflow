// The commands and keys of the drawing tools (Place → Polyline, Arc, Circle, Rectangle, Text), shared by the menu
// bar, the toolbar and the schematic: plain data with no imports from the shell, so either side may read it.
import type { DrawTool } from "./draw-tools.js"

/** In EasyEDA's order. */
export const DRAW_COMMANDS = ["drawPolyline", "drawArc", "drawCircle", "drawRectangle", "drawText"] as const
export type DrawCommand = (typeof DRAW_COMMANDS)[number]

export const DRAW_TOOL_COMMAND: Readonly<Record<DrawTool, DrawCommand>> = {
  polyline: "drawPolyline",
  arc: "drawArc",
  circle: "drawCircle",
  rectangle: "drawRectangle",
  text: "drawText",
}

/** The tool each command (and its key action, which has the same name) arms. */
export const DRAW_COMMAND_TOOL: Readonly<Record<DrawCommand, DrawTool>> = {
  drawPolyline: "polyline",
  drawArc: "arc",
  drawCircle: "circle",
  drawRectangle: "rectangle",
  drawText: "text",
}

export const isDrawCommand = (name: string): name is DrawCommand => (DRAW_COMMANDS as readonly string[]).includes(name)
