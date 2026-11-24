import type { ProtoGrid } from "./proto/grid.js"

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
  /**
   * Where its name and value are drawn on the schematic, and its designator on the silkscreen, when the file moves
   * them (schNameAt, schValueAt, pcbNameAt): offsets from the part's origin, in sheet units and board mm, on the sheet
   * and the board as they are (a turned part does not turn them). Absent, the layout puts them where it always has.
   */
  schNameAt?: Point
  schValueAt?: Point
  pcbNameAt?: Point
  /** The silkscreen designator's turn when the file sets it (pcbNameRotation): 0 reads left to right, 90 from the bottom up. */
  pcbNameRotation?: 0 | 90
  /** Set when the file hides the part's silkscreen designator (pcbNameHidden): nothing is printed or placed for it. */
  pcbNameHidden?: true
  /** The text printed as the part's silkscreen designator in place of its name (pcbNameText), such as IN+ on a wire pad. */
  pcbNameText?: string
  /** The board edge the file asks autoplace to put the part against (pcbEdge), its pins facing inward. */
  pcbEdge?: Side
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

/** A copper layer a pour can fill: "top" and "bottom", and on a 4-layer board "inner1" and "inner2". */
export type PourLayer = "top" | "bottom" | "inner1" | "inner2"

/**
 * A copper pour as the design writes it (`<copperpour>`): the intent, not the copper. The engine computes the fill on
 * every build. `id` is "copperpour:<n>" in source order; `net` is the net's id. Without `outline` it fills the board.
 */
export interface CopperPour {
  id: string
  net: string
  layer: PourLayer
  outline?: Point[]
  /** Where two pours overlap, the higher one keeps the copper; equal ones go in source order. */
  priority: number
  /** The gap to other nets' copper, in mm; absent, the net classes' clearance. */
  clearance?: number
  /** Copper narrower than this is removed, in mm. */
  minWidth: number
  /** How same-net pads join the fill: four spokes, or solid copper. */
  thermal: "relief" | "solid"
  thermalWidth: number
  thermalGap: number
  source: SourceRef
}

/** A non-plated hole (`<hole>`): its centre and diameter in mm. `id` is "hole:<n>" in source order. */
export interface Hole {
  id: string
  x: number
  y: number
  diameter: number
  source: SourceRef
}

/**
 * Words on the board's silkscreen (`<silkscreentext>`): centred on x, y in mm, `height` mm tall, turned `rotation`
 * degrees counter-clockwise, on the top or bottom legend (the bottom one reads from below). `id` is
 * "silkscreentext:<n>" in source order; `name` is the writer's own label for it and does not change the id.
 */
export interface SilkText {
  id: string
  text: string
  x: number
  y: number
  layer: "top" | "bottom"
  height: number
  rotation: number
  name?: string
  source: SourceRef
}

/**
 * The layers a board drawing (`<boardgraphic>`) can go on: the silkscreen as ink, the solder mask as an opening, a
 * copper layer (named as pours name them) as copper of no net.
 */
export type BoardGraphicLayer = "top-silkscreen" | "bottom-silkscreen" | "top-mask" | "bottom-mask" | "top" | "bottom" | "inner1" | "inner2"

/**
 * A drawing from an SVG or DXF file in the project (`<boardgraphic>`), placed on the board: `areas` are its filled
 * shapes and `lines` its stroked lines, both already in board mm (scaled, turned, moved, and mirrored on the bottom so
 * they read right from below). `x`, `y` is its centre, `width` × `height` its placed size in mm. `id` is
 * "boardgraphic:<n>" in source order; `skipped` is what the reader left out of the file, in words.
 */
export interface BoardGraphic {
  id: string
  file: string
  layer: BoardGraphicLayer
  x: number
  y: number
  width: number
  height: number
  rotation: number
  fill: boolean
  name?: string
  /** On copper: the net id it belongs to, when it names one; without it, it belongs to no net. */
  net?: string
  areas: { outer: Point[]; holes: Point[][] }[]
  lines: { points: Point[]; width: number }[]
  /** On copper: the filled areas as triangles (holes left open), the shapes the checks, router and Gerber use. */
  triangles?: Point[][]
  skipped: string[]
  source: SourceRef
}

export interface Board {
  outline: Point[]
  layers: 2 | 4
  thickness: number
  /** True when the circuit gave the thickness; otherwise `thickness` is the default and the rules' figure comes first. */
  thicknessGiven?: true
  schMaxTraceDistance?: number
  keepouts: Keepout[]
  /** The copper pours, in source order; absent when there are none. */
  pours?: CopperPour[]
  /** The non-plated holes, in source order; absent when there are none. */
  holes?: Hole[]
  /** The silkscreen texts, in source order; absent when there are none. */
  silkTexts?: SilkText[]
  /** The drawings from SVG or DXF files, in source order; absent when there are none. */
  graphics?: BoardGraphic[]
  /** A perfboard or stripboard: its hole grid (proto/grid.ts); absent on a made PCB. */
  proto?: ProtoGrid
}

export type DrawingKind = "path" | "rect" | "circle" | "arc" | "text" | "bus" | "junction"
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
 * a name such as "D[0:7]"; `members` are the names of its nets ("D0" … "D7"), and it joins none of them. A
 * junction is the dot Place → Junction puts on a wire, as EasyEDA's; it is drawn, and joins nothing itself.
 */
export type DrawingShape =
  | ({ kind: "path"; points: Point[] } & DrawingStroke)
  | ({ kind: "rect"; x: number; y: number; width: number; height: number; filled: boolean } & DrawingStroke)
  | ({ kind: "circle"; x: number; y: number; radius: number; filled: boolean } & DrawingStroke)
  | ({ kind: "arc"; x: number; y: number; radius: number; startAngle: number; endAngle: number } & DrawingStroke)
  | ({ kind: "text"; x: number; y: number; text: string; fontSize: number; anchor: TextAnchor } & DrawingColor)
  | { kind: "bus"; name: string; points: Point[]; members: string[] }
  | ({ kind: "junction"; x: number; y: number } & DrawingColor)

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
  /** The sub-sheet instance it was drawn in; such a drawing is on the sheet's own page, not the parent's. */
  instance?: string
}

/** The first page of every schematic: it holds whatever no `<page>` wraps. */
export const MAIN_PAGE = "Main"

/** The page a part, trace or drawing is on. */
export const pageOf = (thing: { page?: string }): string => thing.page ?? MAIN_PAGE

/** A sub-sheet port's place on the sheet symbol: a side of the box and the 1-based slot along it (from the top or the left). */
export interface SheetPortSpec {
  name: string
  side: Side
  order: number
  /** A bus port: joins the members of the bus its name stands for ("D[0:7]" is D0 … D7) by name. */
  bus?: true
  /** The electrical type of the instance's pin; absent, passive. */
  type?: PinType
  /** What it carries, e.g. "0 to 24 V from the field". */
  carries?: string
}

/** What a sheet says of itself on `<sheet does sources>`. */
export interface SheetCard {
  does?: string
  sources?: string[]
}

/** The symbol size a `<sheet width height>` writes, in sheet units; absent, the ports decide it. */
export interface SheetSize {
  width?: number
  height?: number
}

/**
 * A sub-sheet port and the flattened net it joins: the parent net when connected, else the instance's own net. A bus
 * port's net is the parent bus it is connected to (or "<path>/<name>"), and `members` are the nets it joins.
 */
export interface InstancePort extends SheetPortSpec {
  net: string
  members?: string[]
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
  /** What the sheet says it does, and its sources, when it says. */
  does?: string
  sources?: string[]
  /** The flattened ids of every part inside, nested instances included, in natural order. */
  parts: string[]
  /** The sheet symbol's size as the sheet file writes it; absent when it writes none. */
  size?: SheetSize
  /** The instance's own schX/schY (and schRotation, when written) and pcbX/pcbY/pcbRotation, when written. */
  sch?: Point & { rotation?: number }
  /** The symbol's schRotation, quarter turns, whenever written, with or without schX/schY. */
  schRotation?: number
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
  /** When the file built is a sheet itself: its name, its ports with their places on the symbol, and the symbol size. */
  sheet?: { name: string; ports: SheetPortSpec[]; size?: SheetSize } & SheetCard
  diagnostics: Diagnostic[]
}
