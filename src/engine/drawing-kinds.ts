// Facts about schematic drawings that the engine, the core and the Studio share. Pure: the Studio bundle imports it.
import type { DrawingKind, DrawingShape, LineStyle, Point, TextAnchor } from "./model.js"
import { NET_NAME } from "./selectors.js"
import { CHAR_WIDTH, clean, type Bounds } from "./symbols/types.js"

const KIND_BY_TAG: Readonly<Record<string, DrawingKind>> = {
  schematicpath: "path",
  schematicrect: "rect",
  schematiccircle: "circle",
  schematicarc: "arc",
  schematictext: "text",
  bus: "bus",
}

const TAG_BY_KIND: Readonly<Record<DrawingKind, string>> = {
  path: "schematicpath",
  rect: "schematicrect",
  circle: "schematiccircle",
  arc: "schematicarc",
  text: "schematictext",
  bus: "bus",
}

export const DEFAULT_STROKE_WIDTH = 0.01
export const DEFAULT_FONT_SIZE = 0.1
export const LINE_STYLES: readonly LineStyle[] = ["solid", "dashed", "dotted"]
export const TEXT_ANCHORS: readonly TextAnchor[] = ["left", "center", "right"]
/** A typo such as D[0:7000] must not make thousands of nets' worth of members. */
export const MAX_BUS_MEMBERS = 1024

/** The drawing kind a tag makes, or undefined for any other tag (including Object's own method names). */
export function drawingKindOf(tag: string): DrawingKind | undefined {
  return Object.hasOwn(KIND_BY_TAG, tag) ? KIND_BY_TAG[tag] : undefined
}

/** The tag that writes a drawing of this kind. */
export function drawingTag(kind: DrawingKind): string {
  return TAG_BY_KIND[kind]
}

/** Exactly the names `net.<name>` accepts, so every member is a net a trace can name. */
const PLAIN = new RegExp(String.raw`^${NET_NAME.source}$`)
const RANGE = new RegExp(String.raw`^(${NET_NAME.source})\[(\d+):(\d+)\]$`)

/** The nets a bus name stands for: "D[0:7]" is D0 … D7, "A[3:0]" is A3 … A0, a plain net name is itself. Anything else is undefined. */
export function busMembers(name: string): string[] | undefined {
  if (PLAIN.test(name)) return [name]
  const range = RANGE.exec(name)
  if (!range) return undefined
  const [prefix, first, last] = [range[1] as string, Number(range[2]), Number(range[3])]
  const count = Math.abs(last - first) + 1
  if (count > MAX_BUS_MEMBERS) return undefined
  const step = last >= first ? 1 : -1
  return Array.from({ length: count }, (_, i) => `${prefix}${first + i * step}`)
}

function pointsBox(points: readonly Point[]): Bounds {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

/** How far a counter-clockwise arc turns: a whole turn or more is 360, anything else is taken modulo 360. */
function sweepOf(startAngle: number, endAngle: number): number {
  const turn = endAngle - startAngle
  return Math.abs(turn) >= 360 ? 360 : ((turn % 360) + 360) % 360
}

/** The box round an arc: its two ends and every quarter point (0°, 90°, …) it passes. */
function arcBox(x: number, y: number, radius: number, startAngle: number, endAngle: number): Bounds {
  const sweep = sweepOf(startAngle, endAngle)
  const angles = [startAngle, startAngle + sweep]
  for (let quarter = Math.ceil(startAngle / 90) * 90; quarter < startAngle + sweep; quarter += 90) angles.push(quarter)
  const at = (degrees: number) => ({ x: x + radius * Math.cos((degrees * Math.PI) / 180), y: y + radius * Math.sin((degrees * Math.PI) / 180) })
  return pointsBox(angles.map(at))
}

function textBox(x: number, y: number, text: string, fontSize: number, anchor: TextAnchor): Bounds {
  const width = CHAR_WIDTH * fontSize * text.length
  const minX = anchor === "left" ? x : anchor === "right" ? x - width : x - width / 2
  return { minX, minY: y - fontSize / 2, maxX: minX + width, maxY: y + fontSize / 2 }
}

function rawBounds(drawing: DrawingShape): Bounds {
  switch (drawing.kind) {
    case "path":
    case "bus":
      return pointsBox(drawing.points)
    case "rect":
      return { minX: drawing.x, minY: drawing.y, maxX: drawing.x + drawing.width, maxY: drawing.y + drawing.height }
    case "circle":
      return { minX: drawing.x - drawing.radius, minY: drawing.y - drawing.radius, maxX: drawing.x + drawing.radius, maxY: drawing.y + drawing.radius }
    case "arc":
      return arcBox(drawing.x, drawing.y, drawing.radius, drawing.startAngle, drawing.endAngle)
    case "text":
      return textBox(drawing.x, drawing.y, drawing.text, drawing.fontSize, drawing.anchor)
  }
}

/** Without floating-point noise or negative zero. */
const tidy = (value: number): number => clean(value) + 0

/** The box round a drawing's shape in sheet units, without its line width. A text is measured as symbol text is. */
export function drawingBounds(drawing: DrawingShape): Bounds {
  const box = rawBounds(drawing)
  return { minX: tidy(box.minX), minY: tidy(box.minY), maxX: tidy(box.maxX), maxY: tidy(box.maxY) }
}
