import type { Offset } from "./component.js"
import { diagnostic } from "./diagnostics.js"
import { busMembers, DEFAULT_FONT_SIZE, DEFAULT_STROKE_WIDTH, drawingTag, LINE_STYLES, TEXT_ANCHORS } from "./drawing-kinds.js"
import { DrawingReader, nonEmpty, pointList, type Parse } from "./drawing-reader.js"
import type { Component, Diagnostic, DrawingKind, DrawingShape, DrawingStroke, Point, SchematicDrawing, SourceRef } from "./model.js"
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

const COLOUR = /^#[0-9a-fA-F]{6}$/
const colour: Parse<string> = (value) => (typeof value === "string" && COLOUR.test(value) ? value : undefined)
const flag: Parse<boolean> = (value) => (typeof value === "boolean" ? value : undefined)
const POINTS = "a list of two or more points with x and y"
const BUS_NAME = 'a net name such as "CLK" or a range such as "D[0:7]"'

function stroke(reader: DrawingReader): DrawingStroke {
  const strokeWidth = reader.number("strokeWidth", DEFAULT_STROKE_WIDTH, "not-negative")
  const lineStyle = reader.choice("lineStyle", LINE_STYLES, "solid")
  const color = reader.optional<string | undefined>("color", colour, 'a colour such as "#000080"', undefined)
  return { strokeWidth, lineStyle, ...(color === undefined ? {} : { color }) }
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
    ...stroke(r),
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

/** The name the file gives, when it is one this kind accepts: any non-empty string, or for a bus one that names its nets. */
function givenName(kind: DrawingKind, props: Props): string | undefined {
  const name = nonEmpty(props["name"])
  return name !== undefined && (kind !== "bus" || busMembers(name) !== undefined) ? name : undefined
}

/** Builds one drawing. A bad or missing value is reported and leaves the drawing out; an unknown prop is reported only. */
export function buildDrawing(kind: DrawingKind, props: Props, origin: DrawingOrigin): BuiltDrawing {
  const name = givenName(kind, props)
  const id = name ?? `drawing:${kind}:${origin.index}`
  const reader = new DrawingReader(props, id, origin.source)
  // A bus reads its name with its shape; for the other kinds a name is optional, but a given one must be usable.
  if (kind !== "bus") reader.optional("name", nonEmpty, "a non-empty string", undefined)
  const shape = SHAPES[kind](reader, origin.offset)
  reader.reportUnread(drawingTag(kind))
  if (!reader.usable) return { diagnostics: reader.diagnostics }
  const groupOffset = { x: origin.offset.schX, y: origin.offset.schY }
  const drawing: SchematicDrawing = { ...shape, id, ...(name === undefined ? {} : { name }), groupOffset, source: origin.source }
  return { drawing, diagnostics: reader.diagnostics }
}

/**
 * Makes every drawing's id one that no part and no earlier drawing has: a repeated name gets "~2", "~3"
 * and so on, with one duplicate-name warning per name. Parts keep their ids whatever order they come in.
 */
export function uniqueDrawingIds(drawings: readonly SchematicDrawing[], parts: readonly Component[]): { drawings: SchematicDrawing[]; diagnostics: Diagnostic[] } {
  const taken = new Set(parts.map((part) => part.id))
  const warned = new Set<string>()
  const diagnostics: Diagnostic[] = []
  const unique = drawings.map((drawing) => {
    if (!taken.has(drawing.id)) {
      taken.add(drawing.id)
      return drawing
    }
    if (!warned.has(drawing.id)) {
      warned.add(drawing.id)
      diagnostics.push(diagnostic("duplicate-name", "warning", `More than one part or drawing is named ${drawing.id}`, [drawing.id], drawing.source))
    }
    let count = 2
    while (taken.has(`${drawing.id}~${count}`)) count++
    const id = `${drawing.id}~${count}`
    taken.add(id)
    return { ...drawing, id }
  })
  return { drawings: unique, diagnostics }
}
