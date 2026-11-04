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
}

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

export interface CircuitModel {
  parts: PartInfo[]
  traces: TraceInfo[]
  skipped: SkippedElement[]
  imports: ImportInfo[]
  /** Offsets of the `<board>` element's closing tag, when there is one. */
  boardClose?: { start: number }
}

export type Edit =
  | { kind: "setProps"; part: string; props: Record<string, Literal> }
  | { kind: "removePart"; part: string }
  /** `schematicRouteHints` are the corners of a wire drawn by hand in the schematic. */
  | { kind: "addTrace"; from: string; to: string; props?: Record<string, Literal>; schematicRouteHints?: Point[] }
  | { kind: "removeTrace"; from: string; to: string }
  /** `importFrom` adds `import { tag } from "<importFrom>"` when it is missing. */
  | { kind: "addPart"; tag: string; name: string; props?: Record<string, Literal>; importFrom?: string }
