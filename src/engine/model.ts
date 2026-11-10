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
  /** The schematic page it is drawn on; absent on the first page, MAIN_PAGE. */
  page?: string
  /** The path of the sub-sheet instance that made it, e.g. "PS1" or "PS1/D1"; absent on the circuit itself. */
  instance?: string
  /** Its name in the sheet file, e.g. "R1" for R101 of an instance with base 100; absent on the circuit itself. */
  localId?: string
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
  /** The page the trace is written on; absent on the first page, MAIN_PAGE. */
  page?: string
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
  /** The page it is drawn on; absent on the first page, MAIN_PAGE. */
  page?: string
}

/** The first page of every schematic: it holds whatever no `<page>` wraps. */
export const MAIN_PAGE = "Main"

/** The page a part, trace or drawing is on. */
export const pageOf = (thing: { page?: string }): string => thing.page ?? MAIN_PAGE

/** A sub-sheet port and the flattened net it joins: the parent net when connected, else the instance's own net. */
export interface InstancePort {
  name: string
  net: string
}

/**
 * One instance of a sub-sheet (`<name>.sheet.tsx`). Its parts are flattened into the circuit with `base` added to
 * each designator's number; a net inside is "<path>/<name>" unless it is a connected port's net (the parent net)
 * or a power or ground name (global).
 */
export interface SheetInstance {
  /** The name prop, e.g. "PS1". */
  name: string
  /** The names of the instances from the circuit down, joined by "/", e.g. "PS1" or "PS1/D1". */
  path: string
  /** The sheet's name: its file name without ".sheet.tsx". */
  sheet: string
  file: string
  /** The instance's own base: written, or the default that follows the previous sibling's span. */
  base: number
  /** What its designators get added: its base plus the bases of the instances around it. */
  designatorBase: number
  /** As written: port name to parent net name. */
  connections: Record<string, string>
  /** The sheet's ports in the order they are written. */
  ports: InstancePort[]
  /** The flattened ids of every part inside, nested instances included, in natural order. */
  parts: string[]
  /** The instance's own schX/schY and pcbX/pcbY/pcbRotation, when written. */
  sch?: Point
  pcb?: { x: number; y: number; rotation: number }
  /** The page it is on; absent on the first page. */
  page?: string
  source: SourceRef
}

export interface Circuit {
  file: string
  /**
   * The schematic's pages in order: MAIN_PAGE first, then each `<page name>` the first time it is written. Pages are
   * drawing only; nets are the circuit's. Absent in a circuit made by hand, which is one page.
   */
  pages?: string[]
  components: Component[]
  nets: Net[]
  connections: Connection[]
  board?: Board
  /** Schematic only: the PCB and the nets ignore them. */
  drawings: SchematicDrawing[]
  /** The sub-sheet instances in source order, outer before inner; absent when there are none. */
  instances?: SheetInstance[]
  diagnostics: Diagnostic[]
}
