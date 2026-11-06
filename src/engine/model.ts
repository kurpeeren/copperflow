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

export interface Circuit {
  file: string
  components: Component[]
  nets: Net[]
  connections: Connection[]
  board?: Board
  diagnostics: Diagnostic[]
}
