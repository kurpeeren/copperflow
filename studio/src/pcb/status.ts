// The words of the canvas status bar: zoom and pointer position, and how far a drag has moved.
import type { Point } from "./geometry.js"
import { formatLength, PCB_ZOOM_REFERENCE_PX, SCHEMATIC_ZOOM_REFERENCE_PX, zoomPercent, type Unit } from "./units.js"

/** The parts of a canvas gesture the status bar reads (the canvases' Gesture fits it). */
export type StatusGesture =
  | { kind: "drag"; offset: Point; moved: boolean; blocker: string | null }
  | { kind: "label"; label: { at: Point }; at: Point; moved: boolean; blocker: string | null }
  | { kind: "pan" | "box" }

export interface StatusInput {
  cursor: Point | undefined
  /** Camera scale in CSS pixels per unit; undefined before the first fit. */
  zoom: number | undefined
  /** The PCB's unit; undefined on the schematic, whose sheet units have no name. */
  unit: Unit | undefined
  gesture: StatusGesture | undefined
}

/** How far the part or label being dragged is from where it started; undefined when nothing visible is dragged. */
function dragDelta(gesture: StatusGesture | undefined): Point | undefined {
  if (gesture?.kind === "drag" && gesture.moved && !gesture.blocker) return gesture.offset
  if (gesture?.kind === "label" && gesture.moved && !gesture.blocker) return { x: gesture.at.x - gesture.label.at.x, y: gesture.at.y - gesture.label.at.y }
  return undefined
}

/** Lengths shown in `unit`; a sheet without a unit shows its own numbers. */
const shown = (value: number, unit: Unit | undefined): string => formatLength(value, unit ?? "mm")

export function statusParts(input: StatusInput): { position: string; drag: string } {
  const { cursor, zoom, unit } = input
  const delta = dragDelta(input.gesture)
  const position = [
    zoom === undefined ? "" : `Zoom ${zoomPercent(zoom, unit ? PCB_ZOOM_REFERENCE_PX : SCHEMATIC_ZOOM_REFERENCE_PX)}%`,
    cursor ? `X ${shown(cursor.x, unit)}  Y ${shown(cursor.y, unit)}` : "",
  ]
  return {
    position: position.filter((part) => part !== "").join("  "),
    drag: delta ? `dX ${shown(delta.x, unit)}  dY ${shown(delta.y, unit)}` : "",
  }
}
