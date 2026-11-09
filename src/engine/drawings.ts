import type { Offset } from "./component.js"
import { diagnostic } from "./diagnostics.js"
import { drawingIds, drawingName, indexId, type DrawingId } from "./drawing-ids.js"
import { busMembers, DEFAULT_FONT_SIZE, DEFAULT_STROKE_WIDTH, drawingTag, LINE_STYLES, TEXT_ANCHORS } from "./drawing-kinds.js"
import { DrawingReader, nonEmpty, pointList, type Parse } from "./drawing-reader.js"
import type { Component, Diagnostic, DrawingColor, DrawingKind, DrawingShape, DrawingStroke, Point, SchematicDrawing, SourceRef } from "./model.js"
import type { Props } from "./read-props.js"

export interface DrawingOrigin {
  /** What the enclosing groups add; drawings use only schX and schY. */
  offset: Offset
  /** The tag's 1-based place among the tags of its kind, in source order, whether or not it is drawn. */
  index: number
  source: SourceRef
}

export interface BuiltDrawing {
  drawing?: SchematicDrawing
  diagnostics: Diagnostic[]
}

/** A drawing tag met in the walk: what the id rule needs, and the drawing when its values were usable. */
export interface DrawingEntry {
  kind: DrawingKind
  name: string | undefined
  source: SourceRef
  drawing?: SchematicDrawing
}

const COLOUR = /^#[0-9a-fA-F]{6}$/
const colour: Parse<string> = (value) => (typeof value === "string" && COLOUR.test(value) ? value : undefined)
const flag: Parse<boolean> = (value) => (typeof value === "boolean" ? value : undefined)
const POINTS = "a list of two or more points with x and y"
const BUS_NAME = 'a net name such as "CLK" or a range such as "D[0:7]"'

/** The colour when the file gives one; none otherwise, so the Studio picks the theme's. */
function colorOf(reader: DrawingReader): DrawingColor {
  const color = reader.optional<string | undefined>("color", colour, 'a colour such as "#000080"', undefined)
  return color === undefined ? {} : { color }
}

function stroke(reader: DrawingReader): DrawingStroke {
  const strokeWidth = reader.number("strokeWidth", DEFAULT_STROKE_WIDTH, "not-negative")
  const lineStyle = reader.choice("lineStyle", LINE_STYLES, "solid")
  return { strokeWidth, lineStyle, ...colorOf(reader) }
}

/** x and y, 0 when absent, with the groups' offset added. */
function corner(reader: DrawingReader, offset: Offset): Point {
  return { x: reader.number("x", 0) + offset.schX, y: reader.number("y", 0) + offset.schY }
}

function points(reader: DrawingReader, offset: Offset): Point[] {
  return reader.required("points", pointList, POINTS, []).map((p) => ({ x: p.x + offset.schX, y: p.y + offset.schY }))
}

const filled = (reader: DrawingReader): boolean => reader.optional("filled", flag, "true or false", false)

type ShapeOf = (reader: DrawingReader, offset: Offset) => DrawingShape

/** One reader per kind; the props each one reads are the props that kind has. */
const SHAPES: Readonly<Record<DrawingKind, ShapeOf>> = {
  path: (r, o) => ({ kind: "path", points: points(r, o), ...stroke(r) }),
  rect: (r, o) => ({ kind: "rect", ...corner(r, o), width: r.need("width", "positive"), height: r.need("height", "positive"), filled: filled(r), ...stroke(r) }),
  circle: (r, o) => ({ kind: "circle", ...corner(r, o), radius: r.need("radius", "positive"), filled: filled(r), ...stroke(r) }),
  arc: (r, o) => ({ kind: "arc", ...corner(r, o), radius: r.need("radius", "positive"), startAngle: r.need("startAngle"), endAngle: r.need("endAngle"), ...stroke(r) }),
  text: (r, o) => ({
    kind: "text",
    ...corner(r, o),
    text: r.required("text", nonEmpty, "a non-empty string", ""),
    fontSize: r.number("fontSize", DEFAULT_FONT_SIZE, "positive"),
    anchor: r.choice("anchor", TEXT_ANCHORS, "left"),
    ...colorOf(r),
  }),
  bus: (r, o) => {
    const named: Parse<{ name: string; members: string[] }> = (value) => {
      const members = typeof value === "string" ? busMembers(value) : undefined
      return members && { name: value as string, members }
    }
    const { name, members } = r.required("name", named, BUS_NAME, { name: "", members: [] })
    return { kind: "bus", name, points: points(r, o), members }
  },
}

/**
 * Builds one drawing from its tag's props and how many children the tag has. A bad or missing value is
 * reported and leaves the drawing out; an unknown prop or a child is reported and ignored.
 */
export function buildDrawing(kind: DrawingKind, props: Props, children: number, origin: DrawingOrigin): BuiltDrawing {
  const name = drawingName(kind, props["name"])
  const id = name ?? indexId(kind, origin.index)
  const reader = new DrawingReader(props, id, origin.source)
  // A bus reads its name with its shape; for the other kinds a name is optional, but a given one must be usable.
  if (kind !== "bus") reader.optional("name", nonEmpty, "a non-empty string", undefined)
  const shape = SHAPES[kind](reader, origin.offset)
  reader.reportUnread(drawingTag(kind))
  if (children > 0) reader.reportChildren(drawingTag(kind))
  if (!reader.usable) return { diagnostics: reader.diagnostics }
  const groupOffset = { x: origin.offset.schX, y: origin.offset.schY }
  const drawing: SchematicDrawing = { ...shape, id, ...(name === undefined ? {} : { name }), groupOffset, source: origin.source }
  return { drawing, diagnostics: reader.diagnostics }
}

/**
 * Gives each drawing its id by the shared rule (drawing-ids.ts), over every drawing tag in source order, the
 * ones a bad value left out included. A repeated name gets one duplicate-name warning; a bus repeating an
 * earlier bus's name is a piece of the same bus and is quiet.
 */
export function uniqueDrawingIds(entries: readonly DrawingEntry[], parts: readonly Component[]): { drawings: SchematicDrawing[]; diagnostics: Diagnostic[] } {
  const ids = drawingIds(entries, parts.map((part) => part.id))
  const warned = new Set<string>()
  const diagnostics: Diagnostic[] = []
  const drawings: SchematicDrawing[] = []
  entries.forEach((entry, index) => {
    const { id, base, repeat } = ids[index] as DrawingId
    if (repeat === "duplicate" && !warned.has(base)) {
      warned.add(base)
      diagnostics.push(diagnostic("duplicate-name", "warning", `More than one part or drawing is named ${base}`, [base], entry.source))
    }
    if (entry.drawing) drawings.push(entry.drawing.id === id ? entry.drawing : { ...entry.drawing, id })
  })
  return { drawings, diagnostics }
}
