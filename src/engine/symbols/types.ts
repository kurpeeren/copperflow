import type { Point, Side } from "../model.js"

export type Anchor = "left" | "center" | "right"
export type TextRole = "reference" | "value" | "pin-name" | "pin-number"

export type Shape =
  | { type: "polyline"; points: Point[]; closed?: boolean; fill?: boolean }
  | { type: "circle"; center: Point; radius: number; fill?: boolean }
  | { type: "arc"; center: Point; radius: number; start: number; end: number } // degrees, counter-clockwise, y up
  | { type: "text"; text: string; at: Point; anchor: Anchor; size: number; role: TextRole }

/** `end` is where a wire attaches. */
export interface SymbolPin {
  number: number
  name: string
  end: Point
  side: Side
}

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface SchSymbol {
  kind: string
  shapes: Shape[]
  pins: SymbolPin[]
  bounds: Bounds
}

/** The schematic grid. Every pin end lies on it. */
export const GRID = 0.1
export const TEXT_SIZE = { reference: 0.16, value: 0.16, "pin-name": 0.12, "pin-number": 0.1 } as const satisfies Record<TextRole, number>
/** A character is this many text sizes wide; fonts are not measured. */
export const CHAR_WIDTH = 0.6

/** Rounds away floating-point noise so that coordinates compare and print cleanly. */
export const clean = (value: number): number => Math.round(value * 1e6) / 1e6

export const pt = (x: number, y: number): Point => ({ x: clean(x), y: clean(y) })

export const line = (...points: [number, number][]): Shape => ({ type: "polyline", points: points.map(([x, y]) => pt(x, y)) })

export const polygon = (points: [number, number][], fill = false): Shape => ({
  type: "polyline",
  points: points.map(([x, y]) => pt(x, y)),
  closed: true,
  ...(fill ? { fill: true } : {}),
})

export const rect = (minX: number, minY: number, maxX: number, maxY: number): Shape =>
  polygon([[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]])

export const circle = (x: number, y: number, radius: number): Shape => ({ type: "circle", center: pt(x, y), radius })

export type TextShape = Extract<Shape, { type: "text" }>

export function text(value: string, at: Point, anchor: Anchor, role: TextRole): TextShape {
  return { type: "text", text: value, at, anchor, size: TEXT_SIZE[role], role }
}

/** A filled arrow head whose point is `tip`, looking along the direction from `from` to `tip`. */
export function arrowHead(from: [number, number], tip: [number, number], length = 0.1, halfWidth = 0.05): Shape {
  const dx = tip[0] - from[0]
  const dy = tip[1] - from[1]
  const norm = Math.hypot(dx, dy) || 1
  const ux = dx / norm
  const uy = dy / norm
  const baseX = tip[0] - ux * length
  const baseY = tip[1] - uy * length
  return polygon([tip, [baseX - uy * halfWidth, baseY + ux * halfWidth], [baseX + uy * halfWidth, baseY - ux * halfWidth]], true)
}

function textExtent(shape: TextShape): Bounds {
  const width = CHAR_WIDTH * shape.size * shape.text.length
  const minX = shape.anchor === "left" ? shape.at.x : shape.anchor === "right" ? shape.at.x - width : shape.at.x - width / 2
  return { minX, maxX: minX + width, minY: shape.at.y - shape.size / 2, maxY: shape.at.y + shape.size / 2 }
}

function shapeExtent(shape: Shape): Bounds {
  if (shape.type === "text") return textExtent(shape)
  if (shape.type === "polyline") {
    const xs = shape.points.map((p) => p.x)
    const ys = shape.points.map((p) => p.y)
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
  }
  const { center, radius } = shape
  return { minX: center.x - radius, maxX: center.x + radius, minY: center.y - radius, maxY: center.y + radius }
}

/** The smallest box around the shapes and the pin ends. */
export function boundsOf(shapes: readonly Shape[], pins: readonly SymbolPin[]): Bounds {
  const boxes = [...shapes.map(shapeExtent), ...pins.map((pin) => ({ minX: pin.end.x, maxX: pin.end.x, minY: pin.end.y, maxY: pin.end.y }))]
  if (boxes.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 }
  return {
    minX: clean(Math.min(...boxes.map((b) => b.minX))),
    minY: clean(Math.min(...boxes.map((b) => b.minY))),
    maxX: clean(Math.max(...boxes.map((b) => b.maxX))),
    maxY: clean(Math.max(...boxes.map((b) => b.maxY))),
  }
}

/** What a drawing says about one pin; the number comes from the component. */
export interface PinPlace {
  end: Point
  side: Side
}

/** The body of a symbol without its labels: shapes and where each pin number ends. */
export interface Drawing {
  shapes: Shape[]
  places: Record<number, PinPlace>
}

export const place = (x: number, y: number, side: Side): PinPlace => ({ end: pt(x, y), side })
