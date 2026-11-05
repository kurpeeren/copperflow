import { buildBoard } from "./board.js"
import { buildPart, NO_OFFSET, type Offset } from "./component.js"
import { diagnostic } from "./diagnostics.js"
import { CircuitCodeError, type Evaluated } from "./evaluate.js"
import { PIN_ROW_DEFAULT_PITCH, pinRowName } from "./footprints/pinrow.js"
import { Fragment, isElement, type CfElement, type ComponentFunction } from "./jsx-runtime.js"
import { KINDS } from "./kinds.js"
import type { Board, Circuit, Component, Diagnostic, SourceRef } from "./model.js"
import { mergeNets } from "./nets.js"
import { PropReader, type Props } from "./read-props.js"
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
const LATER_STAGE = new Set(["via", "hole", "keepout", "copperpour", "port", "netlabel"])
const LIBRARY_PATH = /^parts\/([^/]+)\//
const MAX_DEPTH = 200

interface Frame {
  offset: Offset
  /** The outermost element that led here: the call site of the library component. */
  callSite: SourceRef | undefined
  library: string | undefined
  depth: number
}

class Elaboration {
  readonly components: Component[] = []
  readonly traces: TraceDraft[] = []
  readonly diagnostics: Diagnostic[] = []
  board: Board | undefined
  private readonly nameCounts = new Map<string, number>()
  private readonly duplicated = new Set<string>()

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

  private call(element: CfElement, fn: ComponentFunction, frame: Frame): void {
    const origin = this.evaluated.definedIn(fn)
    let result: unknown
    try {
      result = fn({ ...element.props, children: element.children })
    } catch (error) {
      if (error instanceof CircuitCodeError) throw error
      const message = (error as { message?: unknown } | null)?.message
      const where = origin ?? element.source?.file ?? this.file
      throw new CircuitCodeError(`${where}: ${typeof message === "string" ? message : String(error)}`, { cause: error })
    }
    const library = LIBRARY_PATH.exec(origin ?? "")?.[1] ?? frame.library
    this.visit(result, { ...frame, callSite: frame.callSite ?? element.source, library })
  }

  private tag(element: CfElement, tag: string, frame: Frame): void {
    const source = this.sourceOf(element, frame)
    if (tag === Fragment) return this.visit(element.children, frame)
    if (tag === "group") return this.group(element, frame, source)
    if (tag === "board") return this.boardElement(element, frame, source)
    if (tag === "trace") {
      this.traces.push({ props: element.props, source })
      return
    }
    if (tag in KINDS) return this.part(element, tag, frame, source)
    const severity = LATER_STAGE.has(tag) ? "warning" : "error"
    const message = LATER_STAGE.has(tag) ? `<${tag}> is not supported yet and is ignored` : `<${tag}> is not a copperflow element`
    this.diagnostics.push(diagnostic("unsupported-element", severity, message, [tag], source))
  }

  private group(element: CfElement, frame: Frame, source: SourceRef): void {
    const reader = new PropReader(element.props, "group", source)
    const { offset } = frame
    const next: Offset = {
      pcbX: offset.pcbX + (reader.length("pcbX") ?? 0),
      pcbY: offset.pcbY + (reader.length("pcbY") ?? 0),
      schX: offset.schX + (reader.length("schX") ?? 0),
      schY: offset.schY + (reader.length("schY") ?? 0),
    }
    this.diagnostics.push(...reader.diagnostics)
    this.visit(element.children, { ...frame, offset: next })
  }

  private boardElement(element: CfElement, frame: Frame, source: SourceRef): void {
    if (this.board) this.diagnostics.push(diagnostic("two-boards", "error", "A circuit has one <board>; the second is ignored", ["board"], source))
    else {
      const built = buildBoard(element.props, source)
      this.board = built.board
      this.diagnostics.push(...built.diagnostics)
    }
    this.visit(element.children, frame)
  }

  private part(element: CfElement, tag: string, frame: Frame, source: SourceRef): void {
    const name = element.props["name"]
    if (typeof name !== "string" || name === "") {
      this.diagnostics.push(diagnostic("missing-name", "error", `<${tag}> needs a name`, [tag], source))
      return
    }
    const id = this.uniqueId(name, source)
    const reader = new PropReader(element.props, id, source)
    const footprint = footprintOf(tag, element.props, reader)
    const padCount = footprint === undefined ? undefined : this.options.padCount(footprint)
    const origin = { source, library: frame.library, offset: frame.offset }
    const built = buildPart(tag, id, element.props, origin, { name: footprint, padCount })
    this.components.push(built.component)
    this.diagnostics.push(...reader.diagnostics, ...built.diagnostics)
  }

  private uniqueId(name: string, source: SourceRef): string {
    const count = (this.nameCounts.get(name) ?? 0) + 1
    this.nameCounts.set(name, count)
    if (count === 1) return name
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
  run.visit(evaluated.root, { offset: NO_OFFSET, callSite: undefined, library: undefined, depth: 0 })
  const traces = resolveTraces(run.traces, run.components)
  const nets = mergeNets(traces.nodes, traces.links)
  const joined = nets.filter((net) => net.names.length > 1).map((net) => diagnostic("nets-joined", "warning", `Nets ${net.names.join(" and ")} are joined by a trace`, net.names))
  return {
    file,
    components: run.components,
    nets,
    connections: traces.connections,
    ...(run.board ? { board: run.board } : {}),
    diagnostics: [...run.diagnostics, ...traces.diagnostics, ...joined],
  }
}
