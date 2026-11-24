// Reads an EasyEDA Standard PCB document back: its shapes split into fields (a footprint's own shapes as its
// children), and the copper kinds (TRACK, PAD, VIA, HOLE) decoded into board mm, y up, from the document's own origin.
// The export's tests read what it writes with this, and it reads the editor's own documents the same way. Pure.
import type { Point } from "../model.js"
import { LIB_SEPARATOR, UNIT } from "./easyeda-shapes.js"

export interface ReadShape {
  kind: string
  /** The fields after the kind, as written. */
  fields: string[]
  /** A footprint's (LIB's) own shapes; empty for any other kind. */
  children: ReadShape[]
}

export interface ReadDocument {
  /** The head's x, y: the document point the board's (0, 0) is shown at. */
  origin: Point
  shapes: ReadShape[]
}

export interface ReadPad {
  shape: string
  at: Point
  width: number
  height: number
  layer: number
  net: string
  number: string
  /** Twice the hole radius, in mm; 0 for a pad without a hole. */
  drill: number
  rotation: number
}

export interface ReadTrack {
  width: number
  layer: number
  net: string
  points: Point[]
}

const split = (line: string): ReadShape => {
  const [kind = "", ...fields] = line.split("~")
  return { kind, fields, children: [] }
}

/** One line of the document's `shape` list: a footprint splits into its own fields and its children. */
export function readShape(line: string): ReadShape {
  const [head = "", ...children] = line.split(LIB_SEPARATOR)
  return { ...split(head), children: children.map(split) }
}

/** The document's text read: its origin and its shapes. Throws when it is not an EasyEDA PCB document. */
export function readEasyeda(text: string): ReadDocument {
  const value = JSON.parse(text) as { head?: { docType?: unknown; x?: unknown; y?: unknown }; shape?: unknown }
  if (value.head?.docType !== "3") throw new Error(`not an EasyEDA PCB document (docType ${String(value.head?.docType)})`)
  if (!Array.isArray(value.shape) || !value.shape.every((line) => typeof line === "string")) throw new Error("the document's shape is not a list of strings")
  return { origin: { x: number(value.head.x, "head x"), y: number(value.head.y, "head y") }, shapes: value.shape.map(readShape) }
}

function number(value: unknown, what: string): number {
  const parsed = typeof value === "number" ? value : Number(value)
  if (typeof value === "string" && value.trim() === "") throw new Error(`${what} is empty`)
  if (!Number.isFinite(parsed)) throw new Error(`${what} is not a number: ${String(value)}`)
  return parsed
}

/** A field as a number; `what` names it in the error. */
const field = (shape: ReadShape, index: number, what: string): number => number(shape.fields[index], `${shape.kind} ${what}`)

/** A document point in board mm, y up, seen from `origin`. */
export const boardPoint = (p: Point, origin: Point): Point => ({ x: (p.x - origin.x) * UNIT, y: (origin.y - p.y) * UNIT })

/** "x y x y …" as board points. */
export function readPoints(list: string, origin: Point): Point[] {
  const values = list.trim() === "" ? [] : list.trim().split(/\s+/).map((v) => number(v, "point"))
  if (values.length % 2 !== 0) throw new Error(`an odd number of coordinates: ${list}`)
  return Array.from({ length: values.length / 2 }, (_, i) => boardPoint({ x: values[2 * i] as number, y: values[2 * i + 1] as number }, origin))
}

/** A PAD's fields decoded. */
export function readPad(shape: ReadShape, origin: Point): ReadPad {
  return {
    shape: shape.fields[0] ?? "",
    at: boardPoint({ x: field(shape, 1, "x"), y: field(shape, 2, "y") }, origin),
    width: field(shape, 3, "width") * UNIT,
    height: field(shape, 4, "height") * UNIT,
    layer: field(shape, 5, "layer"),
    net: shape.fields[6] ?? "",
    number: shape.fields[7] ?? "",
    drill: field(shape, 8, "hole radius") * 2 * UNIT,
    rotation: field(shape, 10, "rotation"),
  }
}

/** A TRACK's fields decoded. */
export function readTrack(shape: ReadShape, origin: Point): ReadTrack {
  return { width: field(shape, 0, "width") * UNIT, layer: field(shape, 1, "layer"), net: shape.fields[2] ?? "", points: readPoints(shape.fields[3] ?? "", origin) }
}

/** A VIA's fields decoded: its diameter and drill in mm. */
export function readVia(shape: ReadShape, origin: Point): { at: Point; diameter: number; net: string; drill: number } {
  const at = boardPoint({ x: field(shape, 0, "x"), y: field(shape, 1, "y") }, origin)
  return { at, diameter: field(shape, 2, "diameter") * UNIT, net: shape.fields[3] ?? "", drill: field(shape, 4, "hole radius") * 2 * UNIT }
}

/** A HOLE's fields decoded: its diameter in mm, twice the radius written. */
export function readHole(shape: ReadShape, origin: Point): { at: Point; diameter: number } {
  return { at: boardPoint({ x: field(shape, 0, "x"), y: field(shape, 1, "y") }, origin), diameter: field(shape, 2, "hole radius") * 2 * UNIT }
}

/** Every shape of the document, a footprint's children after the footprint. */
export const allShapes = (document: ReadDocument): ReadShape[] => document.shapes.flatMap((shape) => [shape, ...shape.children])
