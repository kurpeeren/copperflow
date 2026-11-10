// The sheet symbol: the box a sub-sheet instance is drawn as on its parent's page, with a pin per port on the sides
// and in the slots the ports say. Pure data, shared by the schematic layout and the Studio, which drags the pins and
// the corner. The origin is the box's top-left corner; y is up, as in every symbol, so the box runs down from 0.
import type { Point, SheetSize, Side } from "./model.js"
import { boundsOf, CHAR_WIDTH, clean, line, polygon, pt, rect, text, TEXT_SIZE, type SchSymbol, type Shape, type SymbolPin } from "./symbols/types.js"

/** Pins are this far apart along a side, as on a chip. */
export const PORT_PITCH = 0.2
export const PORT_PIN_LENGTH = 0.2
const MIN_WIDTH = 1.2
const MIN_HEIGHT = 0.6
const NAME_GAP = 0.05
const NAME_PADDING = 0.4
const LABEL_GAP = 0.12
/** Half the thickness of a bus pin, drawn hollow so it differs from a net pin at a glance. */
const BUS_HALF = 0.025

/** A port with its place on the symbol, as the sheet file and the design both carry it. */
export interface SymbolPort {
  name: string
  side: Side
  order: number
  bus?: boolean
}

export interface SymbolPinPlace {
  name: string
  side: Side
  order: number
  bus: boolean
  /** Where the pin meets the box, and where a wire attaches, in the symbol's frame. */
  edge: Point
  end: Point
}

export interface SheetSymbolLayout {
  width: number
  height: number
  /** The size the ports and their names need; a written size below it is grown to it. */
  needed: { width: number; height: number }
  pins: SymbolPinPlace[]
}

const roundUp = (value: number): number => clean(Math.ceil(value / PORT_PITCH - 1e-9) * PORT_PITCH)

const nameWidth = (ports: readonly SymbolPort[]): number => Math.max(0, ...ports.map((port) => port.name.length)) * CHAR_WIDTH * TEXT_SIZE["pin-name"]

/** The size the ports need: room for every slot used plus one pitch, and for the names on the left and the right. */
export function neededSize(ports: readonly SymbolPort[]): { width: number; height: number } {
  const on = (side: Side) => ports.filter((port) => port.side === side)
  const deepest = (sides: Side[]) => Math.max(0, ...ports.filter((port) => sides.includes(port.side)).map((port) => port.order))
  const across = (deepest(["top", "bottom"]) + 1) * PORT_PITCH
  const down = (deepest(["left", "right"]) + 1) * PORT_PITCH
  const names = nameWidth(on("left")) + nameWidth(on("right")) + NAME_PADDING
  return { width: roundUp(Math.max(MIN_WIDTH, across, names)), height: roundUp(Math.max(MIN_HEIGHT, down)) }
}

/** Where a pin in slot `order` on `side` meets a box of this size, and where its lead ends. */
export function pinPlace(side: Side, order: number, width: number, height: number): { edge: Point; end: Point } {
  const along = clean(order * PORT_PITCH)
  if (side === "left") return { edge: pt(0, -along), end: pt(-PORT_PIN_LENGTH, -along) }
  if (side === "right") return { edge: pt(width, -along), end: pt(width + PORT_PIN_LENGTH, -along) }
  if (side === "top") return { edge: pt(along, 0), end: pt(along, PORT_PIN_LENGTH) }
  return { edge: pt(along, -height), end: pt(along, -height - PORT_PIN_LENGTH) }
}

/** The box and its pins: the size written, grown to what the ports need, rounded up to the pin pitch. */
export function sheetSymbolLayout(ports: readonly SymbolPort[], size: SheetSize = {}): SheetSymbolLayout {
  const needed = neededSize(ports)
  const width = Math.max(needed.width, roundUp(size.width ?? 0))
  const height = Math.max(needed.height, roundUp(size.height ?? 0))
  const pins = ports.map((port) => ({ name: port.name, side: port.side, order: port.order, bus: port.bus === true, ...pinPlace(port.side, port.order, width, height) }))
  return { width, height, needed, pins }
}

/** The slot nearest a point on a side of the box, at least 1 and within the side's length. */
export function slotAt(side: Side, point: Point, width: number, height: number): number {
  const along = side === "left" || side === "right" ? -point.y : point.x
  const length = side === "left" || side === "right" ? height : width
  const last = Math.max(1, Math.round(length / PORT_PITCH) - 1)
  return Math.min(last, Math.max(1, Math.round(along / PORT_PITCH)))
}

/** The side of the box nearest a point in the symbol's frame, and the slot along it: where a dragged pin lands. */
export function nearestPlace(point: Point, width: number, height: number): { side: Side; order: number } {
  const distances: [Side, number][] = [
    ["left", Math.abs(point.x)],
    ["right", Math.abs(point.x - width)],
    ["top", Math.abs(point.y)],
    ["bottom", Math.abs(point.y + height)],
  ]
  const [side] = distances.reduce((best, next) => (next[1] < best[1] ? next : best))
  return { side, order: slotAt(side, point, width, height) }
}

/** The pin's name inside the box, beside where it meets the edge. */
function pinName(pin: SymbolPinPlace): Shape {
  const { edge } = pin
  if (pin.side === "left") return text(pin.name, pt(edge.x + NAME_GAP, edge.y), "left", "pin-name")
  if (pin.side === "right") return text(pin.name, pt(edge.x - NAME_GAP, edge.y), "right", "pin-name")
  const inward = pin.side === "top" ? -1 : 1
  return text(pin.name, pt(edge.x, edge.y + inward * NAME_GAP * 2), "center", "pin-name")
}

/** A net pin is a line; a bus pin is a hollow bar of the bus's width. */
function lead(pin: SymbolPinPlace): Shape {
  const { edge, end } = pin
  if (!pin.bus) return line([edge.x, edge.y], [end.x, end.y])
  if (edge.y === end.y) return rect(Math.min(edge.x, end.x), edge.y - BUS_HALF, Math.max(edge.x, end.x), edge.y + BUS_HALF)
  return rect(edge.x - BUS_HALF, Math.min(edge.y, end.y), edge.x + BUS_HALF, Math.max(edge.y, end.y))
}

/** The symbol as a part's is drawn: the box, the pins with their names, the instance name above and the sheet name below. */
export function sheetSymbol(instance: string, sheet: string, layout: SheetSymbolLayout): SchSymbol {
  const { width, height } = layout
  const shapes: Shape[] = [polygon([[0, 0], [width, 0], [width, -height], [0, -height]])]
  const pins: SymbolPin[] = layout.pins.map((pin, index) => ({ number: index + 1, name: pin.name, end: pin.end, side: pin.side }))
  for (const pin of layout.pins) shapes.push(lead(pin), pinName(pin))
  const body = boundsOf(shapes, pins)
  const centre = clean(width / 2)
  shapes.push(text(instance, pt(centre, body.maxY + LABEL_GAP), "center", "reference"), text(sheet, pt(centre, body.minY - LABEL_GAP), "center", "value"))
  return { kind: "sheet", shapes, pins, bounds: boundsOf(shapes, pins) }
}
