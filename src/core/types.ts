/** A value copperflow can read from and write back to source code. */
export type Literal = string | number | boolean

export interface PropInfo {
  /** The literal value, or undefined when the prop is an expression. */
  literal: Literal | undefined
  /** The attribute value exactly as written, e.g. `"5.1k"` or `{-4}`. */
  source: string
  editable: boolean
}

export interface PartInfo {
  name: string
  tag: string
  line: number
  props: Record<string, PropInfo>
  editable: boolean
  readonlyReason?: string
  /** Character offsets of the whole element in the source. */
  start: number
  end: number
  /** Tag of the enclosing element, e.g. "board", "page" or "group". */
  parent?: string
  /** The `<page>` it is written in; absent on the first page, "Main". */
  page?: string
}

/** A point in schematic or board units. */
export interface Point {
  x: number
  y: number
}

export interface TraceInfo {
  from: string | undefined
  to: string | undefined
  /** Corners of a wire drawn by hand in the schematic, when written as a literal list. */
  schematicRouteHints?: Point[]
  /** Tag of the enclosing element, e.g. "board" or "group". */
  parent?: string
  props: Record<string, PropInfo>
  line: number
  editable: boolean
  readonlyReason?: string
  start: number
  end: number
  /** The `<page>` it is written in; absent on the first page, "Main". */
  page?: string
}

/**
 * A schematic drawing (`schematicpath`, `schematicrect`, `schematiccircle`, `schematicarc`, `schematictext`
 * or `bus`), addressed by the id the engine gives it (`SchematicDrawing.id`).
 */
export interface DrawingInfo {
  /** Its name, or `drawing:<kind>:<n>` when it has none; a repeat gets `~2`, `~3` (src/engine/drawing-ids.ts). */
  id: string
  tag: string
  /** The name the file gives, when it is a literal; the pieces of one bus share it. */
  name?: string
  /** The points of a path or bus, when they are written as a literal list. */
  points?: Point[]
  /** Tag of the enclosing element, e.g. "board" or "group". */
  parent?: string
  /** The `<page>` it is written in; absent on the first page, "Main". */
  page?: string
  /** Every prop but `name`; `points` is editable when it is a literal list. */
  props: Record<string, PropInfo>
  line: number
  editable: boolean
  readonlyReason?: string
  start: number
  end: number
}

/** A drawing prop's value: `points` takes a list of points, every other prop a literal. */
export type DrawingValue = Literal | Point[]

export interface SkippedElement {
  tag: string
  line: number
  reason: string
}

export interface ImportInfo {
  /** The name used in this file. */
  local: string
  source: string
  /** Offset just after the import declaration. */
  end: number
}

/** A `<page name>` element. One page may be written as several elements; each is listed. */
export interface PageInfo {
  /** Undefined when the name is not a string literal. */
  name: string | undefined
  line: number
  start: number
  end: number
  /** Where `</page>` starts; undefined for `<page name="…" />`. */
  closeStart?: number
}

export interface CircuitModel {
  parts: PartInfo[]
  traces: TraceInfo[]
  drawings: DrawingInfo[]
  skipped: SkippedElement[]
  imports: ImportInfo[]
  /** The `<page>` elements in source order; absent in a model made by hand, which has none. */
  pages?: PageInfo[]
  /** Offsets of the `<board>` element's closing tag, when there is one. */
  boardClose?: { start: number }
}

/**
 * What setProps writes to a prop: a literal; a point, for the props that move a part's labels (schNameAt, schValueAt,
 * pcbNameAt); or null, which removes one of those three props.
 */
export type PropValue = Literal | Point | null

export type Edit =
  | { kind: "setProps"; part: string; props: Record<string, PropValue> }
  | { kind: "removePart"; part: string }
  /** `schematicRouteHints` are the corners of a wire drawn by hand in the schematic. */
  /** `page` puts it in that `<page>` (made when missing); without one, or "Main", it goes on the first page. */
  | { kind: "addTrace"; from: string; to: string; props?: Record<string, Literal>; schematicRouteHints?: Point[]; page?: string }
  | { kind: "removeTrace"; from: string; to: string }
  /** Replaces the corners of a trace's hand-drawn schematic wire; an empty list removes them. */
  | { kind: "setTraceHints"; from: string; to: string; schematicRouteHints: Point[] }
  /**
   * `importFrom` adds `import { tag } from "<importFrom>"` when it is missing. `pinLabels` is written as an object
   * expression, `pinLabels={{ pin1: "cathode" }}`, the way a hand-written file names a built-in part's pins.
   */
  | {
      kind: "addPart"
      tag: string
      name: string
      props?: Record<string, Literal>
      pinLabels?: Record<string, string>
      importFrom?: string
      /** The page it goes on, made when missing; without one, or "Main", the first page. */
      page?: string
    }
  /** Moves a part, and the traces with hand-drawn corners that reach it, onto a page (made when missing); "Main" is the first page. */
  | { kind: "movePartToPage"; part: string; page: string }
  /** Adds an empty `<page name>` at the end of the board. */
  | { kind: "addPage"; name: string }
  /** Renames every `<page>` element of the page. The first page, "Main", has no element and keeps its name. */
  | { kind: "renamePage"; from: string; to: string }
  /** Removes a page's elements and the traces and drawings in them; refused while a part is on it. */
  | { kind: "removePage"; name: string }
  /** Adds a drawing before the board's first trace; `name` is written first, and a bus needs one. */
  | { kind: "addDrawing"; tag: string; name?: string; props: Record<string, DrawingValue>; page?: string }
  | { kind: "removeDrawing"; id: string }
  /** Moves or restyles a drawing, e.g. `{ x, y }` or `{ points }`; a `name` renames it, which changes its id. */
  | { kind: "setDrawingProps"; id: string; props: Record<string, DrawingValue> }
