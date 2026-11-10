import { LIBRARY_OWNED_PROPS } from "../core/library.js"
import { buildBoard } from "./board.js"
import { buildPart, NO_OFFSET, pcbPoint, type Offset } from "./component.js"
import { diagnostic } from "./diagnostics.js"
import { drawingName } from "./drawing-ids.js"
import { drawingKindOf } from "./drawing-kinds.js"
import { buildDrawing, uniqueDrawingIds, type DrawingEntry } from "./drawings.js"
import { CircuitCodeError, type Evaluated } from "./evaluate.js"
import { PIN_ROW_DEFAULT_PITCH, pinRowName } from "./footprints/pinrow.js"
import { Fragment, isElement, type CfElement, type ComponentFunction } from "./jsx-runtime.js"
import { buildKeepout } from "./keepout.js"
import { kindOf } from "./kinds.js"
import {
  MAIN_PAGE,
  type Board,
  type Circuit,
  type Component,
  type Diagnostic,
  type DrawingKind,
  type Keepout,
  type InstancePort,
  type SheetInstance,
  type SheetPortSpec,
  type SheetSize,
  type SourceRef,
} from "./model.js"
import { mergeNets } from "./nets.js"
import { naturalCompare } from "./order.js"
import { PropReader, type Props } from "./read-props.js"
import { placePorts, portMembers, readPorts, readSheetSize } from "./sheet-ports.js"
import { Bases, flatNet, readBase, readConnections, SHEET_FILE, sheetName, traceScope, withBase, type InstanceScope } from "./sheets.js"
import { resolveTraces, type TraceDraft } from "./traces.js"

export interface ElaborateOptions {
  /** How many pads a footprint string has, if known. */
  padCount(footprint: string): number | undefined
}

/**
 * The footprint a part declares, or the one its kind implies: a pinheader with a pin count gets a pin
 * row at its `pitch`, 2.54 mm when it has none. A pitch that is not a length gets a bad-value warning
 * from `reader` and no footprint.
 */
function footprintOf(tag: string, props: Props, reader: PropReader): string | undefined {
  const declared = props["footprint"]
  if (typeof declared === "string" && declared !== "") return declared
  const count = props["pinCount"]
  if (tag !== "pinheader" || typeof count !== "number" || !Number.isInteger(count) || count < 1) return undefined
  if (props["pitch"] === undefined) return pinRowName(count, PIN_ROW_DEFAULT_PITCH)
  const pitch = reader.length("pitch")
  return pitch === undefined ? undefined : pinRowName(count, pitch)
}

/** Tags that are accepted but have no effect until their stage lands. */
const LATER_STAGE = new Set(["via", "hole", "copperpour", "netlabel"])
const LIBRARY_PATH = /^parts\/([^/]+)\//
const MAX_DEPTH = 200

interface Frame {
  offset: Offset
  /** The outermost element that led here: the call site of the library component. */
  callSite: SourceRef | undefined
  library: string | undefined
  depth: number
  /** The `<page>` around it; undefined on the first page. */
  page: string | undefined
  /** The sub-sheet instance it is in; undefined on the circuit itself. */
  instance?: InstanceScope
}

/** An angle as the nearest quarter turn, 0 to 270: a sheet symbol turns as a part's does. */
const quarterTurn = (angle: number): number => (((Math.round(angle / 90) * 90) % 360) + 360) % 360

/** A port as the design lists it: its place, and the net (or for a bus port, the parent bus) it joins. */
function instancePort(port: SheetPortSpec, scope: InstanceScope, written: ReadonlyMap<string, string>): InstancePort {
  if (!port.bus) return { ...port, net: flatNet(scope, port.name) }
  const members = portMembers({ name: port.name, bus: true })
  return { ...port, net: written.get(port.name) ?? `${scope.path}/${port.name}`, members }
}

/** `{ page }` for a thing on a page other than the first, nothing on the first. */
const onPage = (page: string | undefined): { page?: string } => (page === undefined ? {} : { page })

class Elaboration {
  readonly components: Component[] = []
  readonly traces: TraceDraft[] = []
  readonly diagnostics: Diagnostic[] = []
  board: Board | undefined
  readonly keepouts: Keepout[] = []
  /** The pages in the order they are first written, MAIN_PAGE first. */
  readonly pages: string[] = [MAIN_PAGE]
  /** Every drawing tag; ids are given after the walk, so a drawing never renames a part. */
  readonly drawings: DrawingEntry[] = []
  private readonly drawingCounts = new Map<DrawingKind, number>()
  private readonly keepoutSources: SourceRef[] = []
  private readonly nameCounts = new Map<string, number>()
  private readonly duplicated = new Set<string>()
  /** The sub-sheet instances, outer before inner, each set once the walk inside it is done. */
  readonly instances: SheetInstance[] = []
  /** The instance path that made each part name; "" for the circuit itself. */
  private readonly owners = new Map<string, string>()
  private readonly bases = new Bases()
  /** Pairs of instance paths already reported for sharing a base, so their designators are not reported again. */
  private readonly clashingPairs = new Set<string>()
  private readonly instancePaths = new Map<string, number>()
  /** Whether the file built is a sheet itself, so its `<port>` elements are expected. */
  private rootIsSheet = false
  /** The file built, when it is a sheet: its ports and symbol size. */
  sheet: Circuit["sheet"]
  /** The sheet files whose ports and size have been reported on, so each finding is reported once, not per instance. */
  private readonly sheetsRead = new Set<string>()

  constructor(
    private readonly evaluated: Evaluated,
    private readonly file: string,
    private readonly options: ElaborateOptions,
  ) {}

  private sourceOf(element: CfElement, frame: Frame): SourceRef {
    return frame.callSite ?? element.source ?? { file: this.file, line: 1, column: 1, offset: 0 }
  }

  visit(node: unknown, frame: Frame): void {
    if (Array.isArray(node)) return node.forEach((child) => this.visit(child, frame))
    if (!isElement(node)) return
    if (frame.depth > MAX_DEPTH) throw new CircuitCodeError(`${this.file}: components nest more than ${MAX_DEPTH} levels deep`)
    const next = { ...frame, depth: frame.depth + 1 }
    if (typeof node.type === "function") return this.call(node, node.type, next)
    this.tag(node, node.type, next)
  }

  private invoke(element: CfElement, fn: ComponentFunction, origin: string | undefined): unknown {
    try {
      return fn({ ...element.props, children: element.children })
    } catch (error) {
      if (error instanceof CircuitCodeError) throw error
      const message = (error as { message?: unknown } | null)?.message
      const where = origin ?? element.source?.file ?? this.file
      throw new CircuitCodeError(`${where}: ${typeof message === "string" ? message : String(error)}`, { cause: error })
    }
  }

  private call(element: CfElement, fn: ComponentFunction, frame: Frame): void {
    const origin = this.evaluated.definedIn(fn)
    if (origin !== undefined && SHEET_FILE.test(origin)) return this.instance(element, fn, origin, frame)
    const result = this.invoke(element, fn, origin)
    const library = LIBRARY_PATH.exec(origin ?? "")?.[1] ?? frame.library
    if (library !== undefined && frame.library === undefined) this.libraryOverrides(element, library, this.sourceOf(element, frame))
    this.visit(result, { ...frame, callSite: frame.callSite ?? element.source, library })
  }

  /**
   * A library part's generated component spreads the instance's props last, so a prop the part owns
   * (its footprint, MPN, supplier numbers, pin labels or attributes) set on the instance replaces
   * what a person verified. The BOM then marks the line not verified when the values differ.
   */
  private libraryOverrides(element: CfElement, library: string, source: SourceRef): void {
    const owned = Object.keys(element.props).filter((key) => LIBRARY_OWNED_PROPS.includes(key))
    if (owned.length === 0) return
    const name = typeof element.props["name"] === "string" && element.props["name"] !== "" ? element.props["name"] : library
    const message = `${name} sets ${owned.join(", ")}, which library part ${library} owns; parts/${library}/part.yaml no longer describes it`
    this.diagnostics.push(diagnostic("library-override", "warning", message, owned.map((key) => `${name}.${key}`), source))
  }

  /**
   * One instance of a sub-sheet: its parts get the base added to their designators, its nets are its own unless a
   * port connects them or they are power or ground, and its positions are relative to the instance.
   */
  private instance(element: CfElement, fn: ComponentFunction, file: string, frame: Frame): void {
    const source = this.sourceOf(element, frame)
    const sheet = sheetName(file)
    const name = element.props["name"]
    if (typeof name !== "string" || name === "") {
      this.diagnostics.push(diagnostic("missing-name", "error", `An instance of ${sheet} needs a name`, [sheet], source))
      return
    }
    const parent = frame.instance
    const path = this.instancePath(parent ? `${parent.path}/${name}` : name, source)
    if (parent?.files.includes(file)) {
      const message = `${file} contains itself (${path}); a sheet cannot import itself`
      this.diagnostics.push(diagnostic("sheet-recursion", "error", message, [path], source))
      return
    }
    const result = this.invoke(element, fn, file)
    if (!isElement(result) || result.type !== "sheet") {
      this.diagnostics.push(diagnostic("not-a-sheet", "error", `${file} must return <sheet>; ${name} is left out`, [name], source))
      return
    }
    const symbol = this.sheetPorts(result, file, sheet, frame, source)
    const ports = symbol.ports.map((port) => port.name)
    const buses = new Map(symbol.ports.filter((port) => port.bus).map((port) => [port.name, portMembers({ name: port.name, bus: true })]))
    const read = readConnections(element.props["connections"], { name, sheet, ports, buses, source })
    this.diagnostics.push(...read.diagnostics)
    const { base, written } = this.instanceBase(element.props["base"], name, path, parent, source)
    const files = [...(parent?.files ?? []), file]
    const scope: InstanceScope = { name, path, sheet, base: (parent?.base ?? 0) + base, files, parent, ports, connections: read.joins, parts: new Map() }
    const placed = this.instancePlacement(element.props, name, frame.offset, source)
    const index = this.instances.length
    this.instances.push({} as SheetInstance)
    this.visit(result.children, { ...frame, offset: placed.offset, instance: scope })
    this.bases.finish(parent?.path ?? "", path, base, written)
    const parts = this.components.filter((c) => c.instance === path || c.instance?.startsWith(`${path}/`)).map((c) => c.id)
    this.instances[index] = {
      name,
      path,
      sheet,
      file,
      base,
      designatorBase: scope.base,
      connections: Object.fromEntries(read.connections),
      ports: symbol.ports.map((port) => instancePort(port, scope, read.connections)),
      ...(symbol.size ? { size: symbol.size } : {}),
      parts: parts.sort(naturalCompare),
      ...placed.record,
      ...onPage(frame.page),
      source,
    }
  }

  /** A sheet's ports placed on its symbol and its symbol size; what is wrong with them is reported once per sheet file. */
  private sheetPorts(body: CfElement, file: string, sheet: string, frame: Frame, at: SourceRef): { ports: SheetPortSpec[]; size?: SheetSize } {
    const written = readPorts(body.children, (port) => this.sourceOf(port, frame))
    const placed = placePorts(written.ports, sheet, at)
    const size = readSheetSize(body.props, sheet, at)
    if (!this.sheetsRead.has(file)) {
      this.sheetsRead.add(file)
      this.diagnostics.push(...written.diagnostics, ...placed.diagnostics, ...size.diagnostics)
    }
    const ports = placed.ports.map(({ name, side, order, bus }): SheetPortSpec => ({ name, side, order, ...(bus ? { bus: true as const } : {}) }))
    return { ports, ...(Object.keys(size.size).length > 0 ? { size: size.size } : {}) }
  }

  /** A unique path: a second instance of the same name in the same parent is an error and gets "~2", "~3" and so on. */
  private instancePath(path: string, source: SourceRef): string {
    const count = (this.instancePaths.get(path) ?? 0) + 1
    this.instancePaths.set(path, count)
    if (count === 1) return path
    if (count === 2) this.diagnostics.push(diagnostic("duplicate-name", "error", `More than one instance is named ${path}`, [path], source))
    return `${path}~${count}`
  }

  /** The base written, or the next default (see Bases); a base two siblings share is an error. */
  private instanceBase(value: unknown, name: string, path: string, parent: InstanceScope | undefined, source: SourceRef): { base: number; written: boolean } {
    const read = readBase(value, name, source)
    this.diagnostics.push(...read.diagnostics)
    const { base, clashWith } = this.bases.claim(parent?.path ?? "", path, read.base)
    if (clashWith !== undefined) {
      this.clashingPairs.add(`${clashWith}|${path}`)
      const message = `${name} has base ${base}, as ${clashWith.split("/").pop() ?? clashWith} does; give one of them another base`
      this.diagnostics.push(diagnostic("base-clash", "error", message, [clashWith, path], source))
    }
    return { base, written: read.base !== undefined }
  }

  /** The offset inside the instance, and the instance's own position as the design records it. */
  private instancePlacement(props: Props, name: string, offset: Offset, source: SourceRef): { offset: Offset; record: Pick<SheetInstance, "sch" | "pcb"> } {
    const reader = new PropReader(props, name, source)
    const [pcbX, pcbY, schX, schY] = [reader.length("pcbX"), reader.length("pcbY"), reader.length("schX"), reader.length("schY")]
    const turn = reader.angle("pcbRotation")
    const schTurn = reader.angle("schRotation")
    this.diagnostics.push(...reader.diagnostics)
    const at = pcbPoint(offset, pcbX ?? 0, pcbY ?? 0)
    const rotation = ((((offset.pcbRotation ?? 0) + (turn ?? 0)) % 360) + 360) % 360
    const sch = { x: offset.schX + (schX ?? 0), y: offset.schY + (schY ?? 0) }
    const record = {
      ...(schX !== undefined || schY !== undefined ? { sch: { ...sch, ...(schTurn === undefined ? {} : { rotation: quarterTurn(schTurn) }) } } : {}),
      ...(pcbX !== undefined || pcbY !== undefined || turn !== undefined ? { pcb: { ...at, rotation } } : {}),
    }
    return { offset: { pcbX: at.x, pcbY: at.y, schX: sch.x, schY: sch.y, pcbRotation: rotation }, record }
  }

  private tag(element: CfElement, tag: string, frame: Frame): void {
    const source = this.sourceOf(element, frame)
    if (tag === Fragment) return this.visit(element.children, frame)
    if (tag === "sheet") return this.sheetElement(element, frame, source)
    if (tag === "port") return this.port(frame, source)
    if (tag === "group") return this.group(element, frame, source)
    if (tag === "page") return this.page(element, frame, source)
    if (tag === "board") return this.boardElement(element, frame, source)
    if (tag === "keepout") return this.keepout(element, frame, source)
    if (tag === "trace") {
      this.traces.push({ props: element.props, source, ...onPage(frame.page), ...(frame.instance ? { scope: traceScope(frame.instance) } : {}) })
      return
    }
    const drawing = drawingKindOf(tag)
    if (drawing) return this.drawing(element, drawing, frame, source)
    if (kindOf(tag)) return this.part(element, tag, frame, source)
    const severity = LATER_STAGE.has(tag) ? "warning" : "error"
    const message = LATER_STAGE.has(tag) ? `<${tag}> is not supported yet and is ignored` : `<${tag}> is not a copperflow element`
    this.diagnostics.push(diagnostic("unsupported-element", severity, message, [tag], source))
  }

  /** A `<sheet>` is the body of a sheet file: the file built alone is its contents; anywhere else it is an error. */
  private sheetElement(element: CfElement, frame: Frame, source: SourceRef): void {
    if (frame.depth === 1 && !frame.instance) {
      this.rootIsSheet = true
      const name = sheetName(this.file)
      this.sheet = { name, ...this.sheetPorts(element, this.file, name, frame, source) }
    } else {
      const message = "<sheet> is the body of a <name>.sheet.tsx file; use that sheet as a component instead"
      this.diagnostics.push(diagnostic("unsupported-element", "error", message, ["sheet"], source))
    }
    this.visit(element.children, frame)
  }

  /** Ports were read when the instance began; outside a sheet a port joins nothing. */
  private port(frame: Frame, source: SourceRef): void {
    if (frame.instance || this.rootIsSheet) return
    const message = "<port> has an effect only in a sub-sheet (<name>.sheet.tsx); it is ignored"
    this.diagnostics.push(diagnostic("unsupported-element", "warning", message, ["port"], source))
  }

  private group(element: CfElement, frame: Frame, source: SourceRef): void {
    const reader = new PropReader(element.props, "group", source)
    const { offset } = frame
    const at = pcbPoint(offset, reader.length("pcbX") ?? 0, reader.length("pcbY") ?? 0)
    const next: Offset = {
      ...offset,
      pcbX: at.x,
      pcbY: at.y,
      schX: offset.schX + (reader.length("schX") ?? 0),
      schY: offset.schY + (reader.length("schY") ?? 0),
    }
    this.diagnostics.push(...reader.diagnostics)
    this.visit(element.children, { ...frame, offset: next })
  }

  /** A page holds what it wraps; a second page of the same name adds to the first, and `Main` is the first page. */
  private page(element: CfElement, frame: Frame, source: SourceRef): void {
    const name = element.props["name"]
    if (typeof name !== "string" || name.trim() === "") {
      this.diagnostics.push(diagnostic("missing-name", "error", "<page> needs a name; what it holds stays on the page around it", ["page"], source))
      return this.visit(element.children, frame)
    }
    if (frame.instance) {
      const message = `A sheet is drawn on its instance's page: page ${name} in ${frame.instance.sheet} is ignored`
      this.diagnostics.push(diagnostic("page-in-sheet", "error", message, [name], source))
      return this.visit(element.children, frame)
    }
    if (frame.page !== undefined) {
      const message = `Pages do not nest: page ${name} is inside page ${frame.page}, and what it holds stays on ${frame.page}`
      this.diagnostics.push(diagnostic("nested-page", "error", message, [name], source))
      return this.visit(element.children, frame)
    }
    if (!this.pages.includes(name)) this.pages.push(name)
    this.visit(element.children, { ...frame, page: name === MAIN_PAGE ? undefined : name })
  }

  private boardElement(element: CfElement, frame: Frame, source: SourceRef): void {
    if (frame.instance) {
      const message = `A sheet has no <board>; the one in ${frame.instance.sheet} is ignored`
      this.diagnostics.push(diagnostic("board-in-sheet", "error", message, ["board"], source))
    } else if (this.board) this.diagnostics.push(diagnostic("two-boards", "error", "A circuit has one <board>; the second is ignored", ["board"], source))
    else {
      const built = buildBoard(element.props, source)
      this.board = built.board
      this.diagnostics.push(...built.diagnostics)
    }
    this.visit(element.children, frame)
  }

  /** Keepouts are collected wherever they are and given to the board after the walk, so a keepout may come before its board. */
  private keepout(element: CfElement, frame: Frame, source: SourceRef): void {
    const built = buildKeepout(element.props, frame.offset, this.keepouts.length + 1, source)
    this.diagnostics.push(...built.diagnostics)
    this.keepoutSources.push(source)
    if (built.keepout) this.keepouts.push(built.keepout)
  }

  private drawing(element: CfElement, kind: DrawingKind, frame: Frame, source: SourceRef): void {
    const index = (this.drawingCounts.get(kind) ?? 0) + 1
    this.drawingCounts.set(kind, index)
    const built = buildDrawing(kind, element.props, element.children.length, { offset: frame.offset, index, source })
    this.diagnostics.push(...built.diagnostics)
    const inside = frame.instance ? { instance: frame.instance.path } : {}
    const drawn = built.drawing ? { drawing: { ...built.drawing, ...onPage(frame.page), ...inside } } : {}
    const name = drawingName(kind, element.props["name"])
    // A named drawing in a sheet is named per instance, so two instances do not repeat a name; a bus keeps its net names.
    const scoped = name !== undefined && frame.instance && kind !== "bus" ? `${frame.instance.path}/${name}` : name
    this.drawings.push({ kind, name: scoped, source, ...drawn })
  }

  /** One warning for each <keepout> of a circuit that has no <board>. */
  boardlessKeepouts(): Diagnostic[] {
    if (this.board) return []
    return this.keepoutSources.map((source) => diagnostic("bad-value", "warning", "<keepout> needs a <board>; it is ignored", ["keepout"], source))
  }

  private part(element: CfElement, tag: string, frame: Frame, source: SourceRef): void {
    const name = element.props["name"]
    if (typeof name !== "string" || name === "") {
      this.diagnostics.push(diagnostic("missing-name", "error", `<${tag}> needs a name`, [tag], source))
      return
    }
    const scope = frame.instance
    const id = scope ? this.instancePartId(name, scope, source) : this.uniqueId(name, source)
    const reader = new PropReader(element.props, id, source)
    const footprint = footprintOf(tag, element.props, reader)
    const padCount = footprint === undefined ? undefined : this.options.padCount(footprint)
    const origin = { source, library: frame.library, offset: frame.offset }
    const built = buildPart(tag, id, element.props, origin, { name: footprint, padCount })
    const hierarchy = scope ? { instance: scope.path, localId: name } : {}
    this.components.push({ ...built.component, ...onPage(frame.page), ...hierarchy })
    this.diagnostics.push(...reader.diagnostics, ...built.diagnostics)
  }

  /** The flattened designator of a part in an instance; one that another part already has is a base clash. */
  private instancePartId(name: string, scope: InstanceScope, source: SourceRef): string {
    const flat = withBase(name, scope.base)
    const owner = this.owners.get(flat)
    if (owner !== undefined && owner !== scope.path && !this.duplicated.has(flat)) {
      this.duplicated.add(flat)
      if (!this.clashingPairs.has(`${owner}|${scope.path}`)) {
        const message = `${name} of ${scope.path} becomes ${flat}, which is already a part; give ${scope.name} another base`
        this.diagnostics.push(diagnostic("base-clash", "error", message, [scope.path, flat], source))
      }
    }
    const id = this.uniqueId(flat, source, scope.path)
    if (!scope.parts.has(name)) scope.parts.set(name, id)
    return id
  }

  private uniqueId(name: string, source: SourceRef, owner = ""): string {
    const count = (this.nameCounts.get(name) ?? 0) + 1
    this.nameCounts.set(name, count)
    if (count === 1) {
      this.owners.set(name, owner)
      return name
    }
    const first = this.owners.get(name) ?? ""
    if (first !== "" && owner === "" && !this.duplicated.has(name)) {
      this.duplicated.add(name)
      const message = `${name} is already a part of ${first}; give ${first.split("/").pop() ?? first} another base`
      this.diagnostics.push(diagnostic("base-clash", "error", message, [first, name], source))
    }
    if (!this.duplicated.has(name)) {
      this.duplicated.add(name)
      this.diagnostics.push(diagnostic("duplicate-name", "error", `More than one part is named ${name}`, [name], source))
    }
    return `${name}~${count}`
  }
}

/** Turns the evaluated element tree into the circuit model. */
export function elaborate(evaluated: Evaluated, file: string, options: ElaborateOptions): Circuit {
  const run = new Elaboration(evaluated, file, options)
  run.visit(evaluated.root, { offset: NO_OFFSET, callSite: undefined, library: undefined, depth: 0, page: undefined })
  const instances = run.instances.length > 0 ? { instances: run.instances } : {}
  const traces = resolveTraces(run.traces, run.components, (path) => run.instances.find((instance) => instance.path === path)?.file)
  const nets = mergeNets(traces.nodes, traces.links)
  const drawings = uniqueDrawingIds(run.drawings, run.components)
  const joined = nets.filter((net) => net.names.length > 1).map((net) => diagnostic("nets-joined", "warning", `Nets ${net.names.join(" and ")} are joined by a trace`, net.names))
  return {
    file,
    pages: run.pages,
    components: run.components,
    nets,
    connections: traces.connections,
    ...(run.board ? { board: { ...run.board, keepouts: run.keepouts } } : {}),
    drawings: drawings.drawings,
    ...instances,
    ...(run.sheet ? { sheet: run.sheet } : {}),
    diagnostics: [...run.diagnostics, ...drawings.diagnostics, ...run.boardlessKeepouts(), ...traces.diagnostics, ...joined],
  }
}
