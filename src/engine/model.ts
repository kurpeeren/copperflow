/** Where a piece of circuit code is written. `line` and `column` are 1-based, `offset` is the 0-based string index. */
export interface SourceRef {
  file: string
  line: number
  column: number
  offset: number
}

export interface Point {
  x: number
  y: number
}

export type Severity = "error" | "warning"

export interface Diagnostic {
  code: string
  severity: Severity
  message: string
  /** Natural sort order. */
  items: string[]
  source?: SourceRef
}

export type PinType = "power_in" | "power_out" | "ground" | "input" | "output" | "bidirectional" | "passive" | "no_connect"
export type Side = "left" | "right" | "top" | "bottom"

/** `id` is "R1.pin1"; `names[0]` is "pin<n>". */
export interface Pin {
  id: string
  component: string
  number: number
  names: string[]
  type: PinType
}

export interface Component {
  /** The name, e.g. "R1". A repeated name gets "~2", "~3" and so on. */
  id: string
  /** The tag, e.g. "resistor" or "chip". */
  kind: string
  value?: string
  footprint?: string
  mpn?: string
  supplierPartNumbers: Record<string, string[]>
  /** The parts/<id> folder, when a library component made it. */
  library?: string
  pins: Pin[]
  pinSides: Record<number, Side>
  sch?: { x: number; y: number; rotation: number }
  pcb?: { x: number; y: number; rotation: number; side: "top" | "bottom" }
  /** What the enclosing groups add to pcbX/pcbY and schX/schY; zero outside a group. */
  groupOffset: { pcb: Point; sch: Point }
  /** Evaluated props that are JSON values; functions are dropped. */
  props: Record<string, unknown>
  /** The outermost element that produced it. */
  source: SourceRef
}

/** Named: "net.GND". Unnamed: "net:" + the first pin id. */
export interface Net {
  id: string
  names: string[]
  pins: string[]
}

export interface Connection {
  id: string
  from: string
  to: string
  width?: number
  corners?: Point[]
  source: SourceRef
}

/** A region of the board that keeps pads and courtyards out. `id` is "keepout:<n>" in source order. */
export interface Keepout {
  id: string
  outline: Point[]
  layers: "top" | "bottom" | "all"
  source: SourceRef
}

export interface Board {
  outline: Point[]
  layers: 2 | 4
  thickness: number
  schMaxTraceDistance?: number
  keepouts: Keepout[]
}

export type DrawingKind = "path" | "rect" | "circle" | "arc" | "text" | "bus"
export type LineStyle = "solid" | "dashed" | "dotted"
export type TextAnchor = "left" | "center" | "right"

/** A drawing's colour, "#RRGGBB"; without one the Studio uses the theme's drawing colour. */
export interface DrawingColor {
  color?: string
}

/** How a drawing's line looks. */
export interface DrawingStroke extends DrawingColor {
  strokeWidth: number
  lineStyle: LineStyle
}

/**
 * What a drawing is, in sheet units (1 = 1 inch, y up). A rectangle stands on its lower-left corner; an
 * arc runs counter-clockwise from `startAngle` to `endAngle` (degrees from +x, as written). A text has a
 * colour but no line, and its `y` is the middle of its height, as for symbol text. A bus is a line with
 * a name such as "D[0:7]"; `members` are the names of its nets ("D0" … "D7"), and it joins none of them.
 */
export type DrawingShape =
  | ({ kind: "path"; points: Point[] } & DrawingStroke)
  | ({ kind: "rect"; x: number; y: number; width: number; height: number; filled: boolean } & DrawingStroke)
  | ({ kind: "circle"; x: number; y: number; radius: number; filled: boolean } & DrawingStroke)
  | ({ kind: "arc"; x: number; y: number; radius: number; startAngle: number; endAngle: number } & DrawingStroke)
  | ({ kind: "text"; x: number; y: number; text: string; fontSize: number; anchor: TextAnchor } & DrawingColor)
  | { kind: "bus"; name: string; points: Point[]; members: string[] }

/**
 * A schematic-only drawing. `id` is its name, or "drawing:<kind>:<n>" for the n-th tag of that kind in
 * source order when it has none. A repeated name gets "~2", "~3" and so on in source order; a bus may
 * repeat its name quietly (one bus drawn in pieces), any other repeat is warned about. Coordinates are
 * on the sheet with the groups' offsets added: a coordinate prop is the sheet value minus `groupOffset`.
 */
export type SchematicDrawing = DrawingShape & {
  id: string
  /** Absent when the file gives none. */
  name?: string
  /** What the enclosing groups add to schX/schY; zero outside a group. */
  groupOffset: Point
  source: SourceRef
}

export interface Circuit {
  file: string
  components: Component[]
  nets: Net[]
  connections: Connection[]
  board?: Board
  /** Schematic only: the PCB and the nets ignore them. */
  drawings: SchematicDrawing[]
  diagnostics: Diagnostic[]
}
